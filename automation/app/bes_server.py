"""Build Event Service (BES) gRPC server.

Implements google.devtools.build.v1.PublishBuildEvent -- the same service Bazel's
--bes_backend flag connects to. This lets a customer run plain `bazel build` (no wrapper
script) and have build progress stream live to the dashboard: the sample project's .bazelrc
sets --bes_backend=grpc://localhost:<BES_PORT> and --bes_header=x-workspace-id=<id>, Bazel
connects here directly, and each build_event_stream.BuildEvent (wrapped in an Any) is decoded
and relayed to the backend's incremental ingestion endpoint.

Also derives a human-readable failure reason and local action-cache hit/miss counts from the
same event stream -- see _WorkspaceBuildState.
"""

import logging
import sys
import threading
from concurrent import futures
from pathlib import Path

import grpc

sys.path.insert(0, str(Path(__file__).resolve().parent / "generated"))

from build_event_stream import build_event_stream_pb2 as bes_pb2  # noqa: E402
from google.devtools.build.v1 import publish_build_event_pb2 as pb2  # noqa: E402
from google.devtools.build.v1 import publish_build_event_pb2_grpc as pb2_grpc  # noqa: E402
from google.protobuf import empty_pb2  # noqa: E402

from . import bes_relay
from .settings import settings

log = logging.getLogger("bes_server")

WORKSPACE_HEADER = "x-workspace-id"
STDERR_BUFFER_LIMIT = 8000

_ABORT_REASON_NAMES = {
    v: k for k, v in bes_pb2.Aborted.AbortReason.items()
}


class _WorkspaceBuildState:
    """Accumulates cross-event context (console output, abort reason) for the build currently
    in progress in one workspace, so the "finished" event can attach a real failure reason."""

    def __init__(self):
        self.stderr_tail = ""
        self.abort_description: str | None = None

    def append_output(self, text: str) -> None:
        if not text:
            return
        self.stderr_tail = (self.stderr_tail + text)[-STDERR_BUFFER_LIMIT:]

    def error_message(self) -> str | None:
        if self.abort_description:
            return self.abort_description
        tail = self.stderr_tail.strip()
        if not tail:
            return None
        error_lines = [line for line in tail.splitlines() if "ERROR" in line]
        return "\n".join(error_lines[-5:]) if error_lines else tail[-1000:]

    def reset(self) -> None:
        self.stderr_tail = ""
        self.abort_description = None


_states: dict[str, _WorkspaceBuildState] = {}
_states_lock = threading.Lock()


def _state_for(workspace_id: str) -> _WorkspaceBuildState:
    with _states_lock:
        state = _states.get(workspace_id)
        if state is None:
            state = _WorkspaceBuildState()
            _states[workspace_id] = state
        return state


def _event_to_json(event: "bes_pb2.BuildEvent", state: _WorkspaceBuildState) -> dict | None:
    which = event.WhichOneof("payload")

    if which == "started":
        state.reset()
        s = event.started
        return {
            "started": {
                "uuid": s.uuid,
                "command": s.command,
                "startTime": s.start_time.ToJsonString(),
            }
        }

    if which == "progress":
        state.append_output(event.progress.stdout)
        state.append_output(event.progress.stderr)
        return None

    if which == "aborted":
        label = None
        id_case = event.id.WhichOneof("id")
        if id_case == "unconfigured_label":
            label = event.id.unconfigured_label.label
        elif id_case == "configured_label":
            label = event.id.configured_label.label
        reason_name = _ABORT_REASON_NAMES.get(event.aborted.reason, "UNKNOWN")
        description = event.aborted.description or reason_name
        state.abort_description = f"{label}: {description}" if label else description
        return None

    if which == "completed":
        if event.id.WhichOneof("id") != "target_completed":
            return None
        return {
            "id": {"targetCompleted": {"label": event.id.target_completed.label}},
            "completed": {"success": event.completed.success},
        }

    if which == "build_metrics":
        summary = event.build_metrics.action_summary
        remote_cache_hits = sum(
            rc.count for rc in summary.runner_count if rc.name == "remote cache hit"
        )
        return {
            "buildMetrics": {
                "actionsCreated": summary.actions_created,
                "actionsExecuted": summary.actions_executed,
                "remoteCacheHits": remote_cache_hits,
            }
        }

    if which == "finished":
        f = event.finished
        payload = {
            "finished": {
                "finishTime": f.finish_time.ToJsonString(),
                "exitCode": {"code": f.exit_code.code},
            }
        }
        if f.exit_code.code != 0:
            error_message = state.error_message()
            if error_message:
                payload["finished"]["errorMessage"] = error_message
        state.reset()
        return payload

    return None


class PublishBuildEventServicer(pb2_grpc.PublishBuildEventServicer):
    def PublishLifecycleEvent(self, request, context):
        # We don't need lifecycle events (BuildEnqueued/InvocationAttempt*) for anything --
        # just ack so Bazel doesn't treat --bes_lifecycle_events as failing.
        return empty_pb2.Empty()

    def PublishBuildToolEventStream(self, request_iterator, context):
        metadata = dict(context.invocation_metadata())
        workspace_id = metadata.get(WORKSPACE_HEADER, "")
        state = _state_for(workspace_id) if workspace_id else None

        for request in request_iterator:
            ordered = request.ordered_build_event
            stream_id = ordered.stream_id

            if state is not None and ordered.event.WhichOneof("event") == "bazel_event":
                try:
                    inner = bes_pb2.BuildEvent()
                    ordered.event.bazel_event.Unpack(inner)
                    event_json = _event_to_json(inner, state)
                    if event_json:
                        bes_relay.post_event(workspace_id, event_json)
                except Exception:
                    log.exception("failed to decode BES event for workspace %s", workspace_id)

            yield pb2.PublishBuildToolEventStreamResponse(
                stream_id=stream_id,
                sequence_number=ordered.sequence_number,
            )


def serve() -> grpc.Server:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=16))
    pb2_grpc.add_PublishBuildEventServicer_to_server(PublishBuildEventServicer(), server)
    server.add_insecure_port(f"[::]:{settings.bes_port}")
    server.start()
    log.info("BES gRPC server listening on port %d", settings.bes_port)
    return server


def start_in_background() -> None:
    thread = threading.Thread(target=lambda: serve().wait_for_termination(), daemon=True)
    thread.start()
