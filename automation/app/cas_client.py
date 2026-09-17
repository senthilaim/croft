"""A minimal ByteStream.Read client for fetching BEP-referenced files back out of Buildfarm's CAS.

Bazel doesn't hand out local file:// paths for the JSON trace profile or per-action stdout/stderr
once a remote cache is configured (which every workspace in this app has) -- per
--remote_build_event_upload's own docs, these specific files always get uploaded and cited as
bytestream://<host>/<resource_name> instead, even in "minimal" upload mode. This reads them back
from whichever Buildfarm server the URI names -- the same one Bazel just uploaded to.
"""

import logging
import re
import sys
import time
from pathlib import Path

import grpc

sys.path.insert(0, str(Path(__file__).resolve().parent / "generated"))

from google.bytestream import bytestream_pb2, bytestream_pb2_grpc  # noqa: E402

log = logging.getLogger("cas_client")

_BYTESTREAM_URI_RE = re.compile(r"^bytestream://([^/]+)/(.+)$")

# --bes_upload_mode=nowait_for_upload_complete (set in the generated .bazelrc, so this build's
# own BES events don't block on artifact uploads finishing) means the event announcing a blob's
# bytestream:// URI can reach us before that blob is actually committed to the remote cache --
# observed in practice as a NOT_FOUND on the very next read. A short retry window covers it
# without meaningfully delaying event processing.
READ_RETRY_ATTEMPTS = 6
READ_RETRY_DELAY_SECONDS = 0.4


def _read_once(target: str, resource_name: str, cap: int) -> bytes:
    with grpc.insecure_channel(target) as channel:
        stub = bytestream_pb2_grpc.ByteStreamStub(channel)
        request = bytestream_pb2.ReadRequest(resource_name=resource_name, read_limit=cap)
        chunks = bytearray()
        for response in stub.Read(request, timeout=10):
            chunks.extend(response.data)
            if len(chunks) >= cap:
                break
        return bytes(chunks[:cap])


def read_blob(uri: str, cap: int) -> bytes | None:
    """Reads up to `cap` bytes from a bytestream:// URI. Returns None on any failure (server
    unreachable, blob missing, timeout) rather than raising -- callers treat this the same as an
    unreadable local file."""
    match = _BYTESTREAM_URI_RE.match(uri)
    if not match:
        return None
    target, resource_name = match.groups()

    for attempt in range(READ_RETRY_ATTEMPTS):
        try:
            return _read_once(target, resource_name, cap)
        except grpc.RpcError as err:
            if attempt == READ_RETRY_ATTEMPTS - 1:
                log.warning("failed to read CAS blob %s: %s", uri, err.code())
                return None
            time.sleep(READ_RETRY_DELAY_SECONDS)
    return None
