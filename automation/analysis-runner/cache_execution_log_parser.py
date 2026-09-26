#!/usr/bin/env python3
"""Turns the file written by `bazel build --execution_log_json_file=<file>` into the compact
summary Croft shows for a cache check: how many remote-cacheable actions were actually served by
the real remote cache. Runs inside the sandboxed cache-check container, same reasoning as
explain_parser.py/parse_query.py (dependency-free, independently unit-testable without Docker or a
real Bazel invocation).

The on-disk shape (verified this session against a real captured log, not from docs) is NOT a JSON
array and NOT one-object-per-line NDJSON -- it's a stream of individually pretty-printed JSON
objects concatenated directly with no separator between them, one per Spawn. Parsed here with
repeated `json.JSONDecoder.raw_decode`, which stops at the end of each value regardless of
surrounding whitespace/newlines.

Each record's fields of interest (real field names, verified against a real captured log):
`targetLabel`, `mnemonic`, `runner` (a human string, e.g. "remote cache hit" or
"processwrapper-sandbox"), `cacheHit` (bool), `remoteCacheable` (bool -- whether this action was
even eligible for the remote cache; a purely local/internal action like a symlink tree is not, and
is excluded here rather than counted as a miss, which would understate the real hit rate).
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Iterator


def _iter_records(text: str) -> Iterator[dict]:
    decoder = json.JSONDecoder()
    idx = 0
    length = len(text)
    while idx < length:
        chunk = text[idx:]
        stripped = chunk.lstrip()
        if not stripped:
            return
        try:
            obj, end = decoder.raw_decode(stripped)
        except json.JSONDecodeError:
            return
        idx += (len(chunk) - len(stripped)) + end
        yield obj


def parse_execution_log(text: str) -> dict:
    actions: list[dict] = []
    for record in _iter_records(text):
        if not record.get("remoteCacheable"):
            continue  # not eligible for the remote cache at all -- excluded, not counted as a miss
        actions.append(
            {
                "targetLabel": record.get("targetLabel", ""),
                "mnemonic": record.get("mnemonic", ""),
                "runner": record.get("runner", ""),
                "cacheHit": bool(record.get("cacheHit", False)),
            }
        )

    cacheable_actions = len(actions)
    remote_cache_hits = sum(1 for a in actions if a["cacheHit"])
    hit_rate_percent = round(remote_cache_hits / cacheable_actions * 100, 1) if cacheable_actions else 0.0

    return {
        "actions": actions,
        "cacheableActions": cacheable_actions,
        "remoteCacheHits": remote_cache_hits,
        "hitRatePercent": hit_rate_percent,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--read-log", required=True, help="execution log from the read-check build")
    parser.add_argument("--roundtrip-log", required=True, help="execution log from the round-trip-check build")
    args = parser.parse_args()

    with open(args.read_log, encoding="utf-8") as f:
        read_check = parse_execution_log(f.read())
    with open(args.roundtrip_log, encoding="utf-8") as f:
        roundtrip_check = parse_execution_log(f.read())

    json.dump({"readCheck": read_check, "roundTripCheck": roundtrip_check}, sys.stdout)


if __name__ == "__main__":
    main()
