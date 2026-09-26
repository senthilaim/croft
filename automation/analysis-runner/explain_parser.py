#!/usr/bin/env python3
"""Turns the text written by `bazel build --explain=<file> --verbose_explanations` into the
compact summary Croft shows for a rebuild simulation: which actions re-ran on the second build and
why. Runs inside the sandboxed simulation container, same reasoning as parse_query.py (kept
dependency-free and independently unit-testable without Docker or a real Bazel invocation).

The line shapes below come from a real captured --explain log (two builds inside one container, so
Bazel's local action cache actually persisted between them -- see explain_parser_test.py's fixture),
not from Bazel's documentation, which doesn't nail down the exact text. Two observed shapes:

    Executing action 'Compiling core.cc': action changed since cached execution.
    Executing runfiles for //:app: no entry in the cache (action is new).

Anything else (the leading "Build options: ..." line, blank lines, future Bazel versions'
messages Croft hasn't seen yet) is preserved verbatim in `unparsedLines` rather than dropped
silently or raising -- the same graceful-degradation approach parse_query.py takes for unknown
rule kinds.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

_ACTION_RE = re.compile(r"^Executing action '(?P<desc>.+)': (?P<reason>.+)\.$")
_RUNFILES_RE = re.compile(r"^Executing runfiles for (?P<desc>.+): (?P<reason>.+)\.$")

# Ordered (first match wins) substring checks, same pattern as the diagnosis-rule engines
# elsewhere in Croft -- classifies the free-text reason into the handful of categories that
# actually matter for "why did this rebuild": a real content/input change vs. an action that
# always re-executes regardless of any edit vs. a first-time (cold) build.
_CATEGORY_RULES: list[tuple[str, str]] = [
    ("no entry in the cache", "new"),
    ("unconditional execution is requested", "unconditional"),
    ("action changed since cached execution", "changed"),
    ("dependency", "changed"),
    ("input", "changed"),
    ("environment", "changed"),
]


def _categorize(reason: str) -> str:
    lowered = reason.lower()
    for substring, category in _CATEGORY_RULES:
        if substring in lowered:
            return category
    return "other"


def parse_explain_log(text: str) -> dict:
    rebuilt_actions: list[dict] = []
    unparsed_lines: list[str] = []

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("Build options:"):
            continue
        match = _ACTION_RE.match(line) or _RUNFILES_RE.match(line)
        if not match:
            unparsed_lines.append(line)
            continue
        reason = match.group("reason")
        rebuilt_actions.append(
            {
                "description": match.group("desc"),
                "reason": reason,
                "category": _categorize(reason),
            }
        )

    counts_by_category: dict[str, int] = {}
    for action in rebuilt_actions:
        counts_by_category[action["category"]] = counts_by_category.get(action["category"], 0) + 1

    return {
        "rebuiltActions": rebuilt_actions,
        "totalActionsRebuilt": len(rebuilt_actions),
        "countsByCategory": counts_by_category,
        "unparsedLines": unparsed_lines,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--baseline-total-actions",
        type=int,
        required=True,
        help="Actions executed by the first (cold) build -- the full action-graph size, used as "
        "the denominator for the 'N of M actions rebuilt' summary.",
    )
    args = parser.parse_args()

    text = sys.stdin.read()
    result = parse_explain_log(text)
    result["baselineTotalActions"] = args.baseline_total_actions
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
