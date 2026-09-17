"""Build Event Service (BES) gRPC server.

Implements google.devtools.build.v1.PublishBuildEvent -- the same service Bazel's
--bes_backend flag connects to. This lets a customer run plain `bazel build` (no wrapper
script) and have build progress stream live to the dashboard: the sample project's .bazelrc
sets --bes_backend=grpc://localhost:<BES_PORT> and --bes_header=x-workspace-id=<id>, Bazel
connects here directly, and each build_event_stream.BuildEvent (wrapped in an Any) is decoded
and relayed to the backend's incremental ingestion endpoint.

Also derives a human-readable failure reason, a full console log, failed-action detail, a timing
waterfall, and per-test-target results from the same event stream -- see _InvocationState and
_read_waterfall. State is keyed by Bazel's own invocation id (StreamId.invocation_id, present on
every request), not by workspace, so two concurrent builds in the same workspace no longer share
one buffer.

The failed-action stdout/stderr text and the timing waterfall are both fetched via ByteStream from
Buildfarm's CAS (see cas_client.py) rather than read off local disk -- Bazel uploads these there
and cites bytestream:// URIs once a remote cache is configured, which every workspace here has.
Both degrade to "unavailable" rather than erroring when a blob can't be read (already evicted,
unreachable, etc).
"""

import gzip
import io
import json
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

from . import bes_relay, cas_client
from .settings import settings

log = logging.getLogger("bes_server")

WORKSPACE_HEADER = "x-workspace-id"
STDERR_BUFFER_LIMIT = 8000
ACTION_LOG_READ_CAP = 200_000  # bytes, per stdout/stderr file
PROFILE_READ_CAP = 20_000_000  # bytes, the gzipped trace profile
MAX_WATERFALL_SPANS = 300
MAX_ARTIFACTS_PER_TARGET = 30
DEFAULT_OUTPUT_GROUP = "default"
PROFILE_NAME_SUFFIXES = (".profile.gz", ".profile.json.gz")

_ABORT_REASON_NAMES = {
    v: k for k, v in bes_pb2.Aborted.AbortReason.items()
}

# Folds Bazel's rarer infra-failure statuses (NO_STATUS/REMOTE_FAILURE/FAILED_TO_BUILD/
# TOOL_HALTED_BEFORE_TESTING) into "failed" so the shared TestRunStatus type stays small --
# a test grid doesn't need to distinguish "the runner never even started" from "it failed".
_TEST_STATUS_NAMES = {
    bes_pb2.PASSED: "passed",
    bes_pb2.FLAKY: "flaky",
    bes_pb2.TIMEOUT: "timeout",
    bes_pb2.FAILED: "failed",
    bes_pb2.INCOMPLETE: "incomplete",
}


class _InvocationState:
    """Accumulates cross-event context (console output, abort reason) for one Bazel invocation,
    so the "finished" event can attach a real failure reason and full console log. One instance
    per invocation id -- discarded once that invocation's "finished" event is processed."""

    def __init__(self):
        self.stderr_tail = ""
        self.abort_description: str | None = None
        # NamedSetOfFiles events always arrive before the TargetComplete event(s) that
        # reference them (a BEP ordering guarantee), so caching them here as they stream in is
        # enough to resolve a target's real outputs once it completes. Keyed by the set's own
        # opaque id, which -- per the proto's own doc comment -- is only valid within this one
        # invocation, matching where this cache already lives.
        self.named_sets: dict[str, "bes_pb2.NamedSetOfFiles"] = {}

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

    def full_console_log(self) -> str | None:
        tail = self.stderr_tail.strip()
        return tail or None


_states: dict[str, _InvocationState] = {}
_states_lock = threading.Lock()


def _state_for(invocation_id: str) -> _InvocationState:
    with _states_lock:
        state = _states.get(invocation_id)
        if state is None:
            state = _InvocationState()
            _states[invocation_id] = state
        return state


def _discard_state(invocation_id: str) -> None:
    with _states_lock:
        _states.pop(invocation_id, None)


def _read_file_bytes(uri: str, cap: int) -> bytes | None:
    """Reads a BEP File.uri regardless of which scheme Bazel gave it: file:// when no remote
    cache is configured (rare in this app), bytestream:// otherwise (the normal case -- see
    cas_client.py for why). None on any failure; never raises."""
    if uri.startswith("file://"):
        try:
            with open(uri[len("file://"):], "rb") as f:
                return f.read(cap)
        except OSError:
            return None
    if uri.startswith("bytestream://"):
        return cas_client.read_blob(uri, cap)
    return None


def _read_local_text(file_ref: "bes_pb2.File") -> str | None:
    if not file_ref.uri:
        return None
    data = _read_file_bytes(file_ref.uri, ACTION_LOG_READ_CAP)
    return data.decode("utf-8", errors="replace") if data is not None else None


def _find_profile_uri(build_tool_logs: "bes_pb2.BuildToolLogs") -> str | None:
    for f in build_tool_logs.log:
        if f.uri and f.name.endswith(PROFILE_NAME_SUFFIXES):
            return f.uri
    return None


def _read_waterfall(uri: str) -> list[dict] | None:
    """Parses Bazel's own JSON trace profile (Chrome Trace Event Format) into timing spans.
    This -- not BEP's per-action events -- is the source for the waterfall, since it covers every
    action regardless of success/failure, with no extra bazelrc flag needed."""
    raw = _read_file_bytes(uri, PROFILE_READ_CAP)
    if raw is None:
        return None
    try:
        with gzip.open(io.BytesIO(raw), "rt", encoding="utf-8") as f:
            trace = json.load(f)
    except (OSError, EOFError, json.JSONDecodeError, UnicodeDecodeError):
        return None

    events = trace.get("traceEvents", [])
    lanes: dict[int, str] = {}
    for e in events:
        if e.get("ph") == "M" and e.get("name") == "thread_name":
            tid = e.get("tid")
            name = (e.get("args") or {}).get("name")
            if tid is not None and name:
                lanes[tid] = name

    spans = []
    for e in events:
        if e.get("ph") != "X":
            continue
        ts, dur = e.get("ts"), e.get("dur")
        if ts is None or dur is None:
            continue
        spans.append(
            {
                "name": e.get("name", ""),
                "category": e.get("cat", ""),
                "lane": lanes.get(e.get("tid"), f"thread {e.get('tid')}"),
                "tsUs": ts,
                "durUs": dur,
            }
        )
    if not spans:
        return None

    min_ts = min(s["tsUs"] for s in spans)
    spans.sort(key=lambda s: s["durUs"], reverse=True)
    spans = spans[:MAX_WATERFALL_SPANS]
    return [
        {
            "name": s["name"],
            "category": s["category"],
            "lane": s["lane"],
            "startMs": (s["tsUs"] - min_ts) / 1000.0,
            "durationMs": s["durUs"] / 1000.0,
        }
        for s in spans
    ]


def _resolve_output_group_files(
    state: _InvocationState, file_sets: "list[bes_pb2.BuildEventId.NamedSetOfFilesId]"
) -> list[dict]:
    """Walks a target's default-output-group file-set DAG (see _InvocationState.named_sets) into
    a flat, deduped list of downloadable files."""
    seen_set_ids: set[str] = set()
    seen_uris: set[str] = set()
    results: list[dict] = []

    def walk(set_id: str) -> None:
        if set_id in seen_set_ids or len(results) >= MAX_ARTIFACTS_PER_TARGET:
            return
        seen_set_ids.add(set_id)
        named_set = state.named_sets.get(set_id)
        if named_set is None:
            return
        for f in named_set.files:
            if len(results) >= MAX_ARTIFACTS_PER_TARGET:
                return
            if not f.uri or f.uri in seen_uris:
                continue
            seen_uris.add(f.uri)
            results.append({"name": f.name, "uri": f.uri, "sizeBytes": f.length})
        for nested in named_set.file_sets:
            walk(nested.id)

    for file_set in file_sets:
        walk(file_set.id)
    return results


def _event_to_json(event: "bes_pb2.BuildEvent", state: _InvocationState) -> dict | None:
    which = event.WhichOneof("payload")

    if which == "started":
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

    if which == "named_set_of_files":
        state.named_sets[event.id.named_set.id] = event.named_set_of_files
        return None

    if which == "completed":
        if event.id.WhichOneof("id") != "target_completed":
            return None
        label = event.id.target_completed.label
        artifacts = []
        for output_group in event.completed.output_group:
            if output_group.name == DEFAULT_OUTPUT_GROUP:
                artifacts = _resolve_output_group_files(state, output_group.file_sets)
        payload = {
            "id": {"targetCompleted": {"label": label}},
            "completed": {"success": event.completed.success},
        }
        if artifacts:
            payload["artifacts"] = [{"targetLabel": label, **a} for a in artifacts]
        return payload

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

    if which == "action":
        action = event.action
        # By default Bazel only emits this event for failed actions (capturing every action
        # requires --build_event_publish_all_actions, which we don't set) -- so this is already
        # the "failed actions" table, no extra filtering needed downstream.
        if action.success:
            return None
        action_id = event.id.action_completed
        return {
            "action": {
                "label": action_id.label or None,
                "primaryOutputPath": action_id.primary_output or None,
                "mnemonic": action.type,
                "exitCode": action.exit_code,
                "commandLine": list(action.command_line),
                "startTime": action.start_time.ToJsonString() if action.HasField("start_time") else None,
                "endTime": action.end_time.ToJsonString() if action.HasField("end_time") else None,
                "stdout": _read_local_text(action.stdout),
                "stderr": _read_local_text(action.stderr),
            }
        }

    if which == "test_summary":
        summary = event.test_summary
        duration = summary.total_run_duration
        return {
            "testSummary": {
                "label": event.id.test_summary.label,
                "status": _TEST_STATUS_NAMES.get(summary.overall_status, "failed"),
                "runCount": summary.run_count,
                "totalDurationMs": duration.seconds * 1000 + duration.nanos // 1_000_000,
            }
        }

    if which == "build_tool_logs":
        profile_uri = _find_profile_uri(event.build_tool_logs)
        waterfall = _read_waterfall(profile_uri) if profile_uri else None
        return {"waterfall": waterfall} if waterfall else None

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
        console_log = state.full_console_log()
        if console_log:
            payload["finished"]["consoleLog"] = console_log
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

        for request in request_iterator:
            ordered = request.ordered_build_event
            stream_id = ordered.stream_id
            invocation_id = stream_id.invocation_id

            if workspace_id and invocation_id and ordered.event.WhichOneof("event") == "bazel_event":
                try:
                    inner = bes_pb2.BuildEvent()
                    ordered.event.bazel_event.Unpack(inner)
                    state = _state_for(invocation_id)
                    event_json = _event_to_json(inner, state)
                    if event_json is not None:
                        event_json["invocationId"] = invocation_id
                        bes_relay.post_event(workspace_id, event_json)
                    if inner.WhichOneof("payload") == "finished":
                        _discard_state(invocation_id)
                except Exception:
                    log.exception(
                        "failed to decode BES event for workspace %s invocation %s",
                        workspace_id,
                        invocation_id,
                    )

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
