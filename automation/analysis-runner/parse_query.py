#!/usr/bin/env python3
"""Turns the output of `bazel query --output=jsonproto --keep_going 'kind(rule, //...)'` into the
compact summary Croft stores: a target-kind histogram, an external-dependency list, and a
package-level dependency graph. Runs inside the sandboxed analysis container so the (potentially
large) raw query output never has to cross out of it -- only this derived summary does.

Kept dependency-free (stdlib only) so it needs nothing beyond the base image, and importable on its
own for unit tests (see parse_query_test.py) without needing Docker or a real Bazel invocation.
"""

from __future__ import annotations

import argparse
import json
import sys

# Package graphs above this many nodes are capped to the most-connected ones, both so the Mongo
# document stays a sane size and so the frontend's graph canvas stays usable.
MAX_GRAPH_NODES = 300


def _label_to_package_id(label: str) -> str:
    """Collapses a fully-qualified label to its package/repo id: "//foo/bar:baz" -> "//foo/bar";
    an external label like "@@boost~1.2.3//:boost" or "@boost//:boost" -> "@boost" (version suffix
    and any package path within the external repo are dropped, so all deps on one external repo
    collapse to a single graph node)."""
    if label.startswith("@"):
        repo = label.lstrip("@").split("//", 1)[0]
        # Bzlmod canonical names carry a version after "~" (older) or "+" (newer); strip it so
        # different versions of the same external repo don't appear as separate nodes.
        repo = repo.split("~", 1)[0].split("+", 1)[0]
        return f"@{repo}" if repo else label
    return label.split(":", 1)[0]


def _attr(rule: dict, name: str) -> list[str]:
    for attribute in rule.get("attribute", []):
        if attribute.get("name") == name:
            return attribute.get("stringListValue") or (
                [attribute["stringValue"]] if "stringValue" in attribute else []
            )
    return []


def parse_query_result(results: list[dict], *, commit_sha: str, partial: bool) -> dict:
    """`results` is the parsed form of `bazel query --output=streamed_jsonproto` -- one JSON object
    per line, each a Target proto (there is no top-level wrapper object for this output format)."""
    targets_by_kind: dict[str, int] = {}
    packages: set[str] = set()
    node_target_count: dict[str, int] = {}
    edges: set[tuple[str, str]] = set()
    external_repos: set[str] = set()

    for result in results:
        rule = result.get("rule")
        if not rule or result.get("type") != "RULE":
            continue
        name = rule.get("name", "")
        kind = rule.get("ruleClass", "unknown")
        targets_by_kind[kind] = targets_by_kind.get(kind, 0) + 1

        source_pkg = _label_to_package_id(name)
        packages.add(source_pkg)
        node_target_count[source_pkg] = node_target_count.get(source_pkg, 0) + 1

        for dep_label in _attr(rule, "deps"):
            target_id = _label_to_package_id(dep_label)
            if target_id == source_pkg:
                continue
            if target_id.startswith("@"):
                external_repos.add(target_id)
            edges.add((source_pkg, target_id))

    all_node_ids = packages | external_repos
    nodes = [
        {"id": node_id, "targetCount": node_target_count.get(node_id, 0)} for node_id in all_node_ids
    ]
    truncated = False
    if len(nodes) > MAX_GRAPH_NODES:
        degree: dict[str, int] = {n["id"]: 0 for n in nodes}
        for source, target in edges:
            degree[source] = degree.get(source, 0) + 1
            degree[target] = degree.get(target, 0) + 1
        kept_ids = {
            node_id
            for node_id, _ in sorted(degree.items(), key=lambda kv: kv[1], reverse=True)[:MAX_GRAPH_NODES]
        }
        nodes = [n for n in nodes if n["id"] in kept_ids]
        edges = {(s, t) for s, t in edges if s in kept_ids and t in kept_ids}
        truncated = True

    total_targets = sum(targets_by_kind.values())
    warnings: list[str] = []
    if partial and total_targets == 0:
        # Distinct from the milder case below: --keep_going kicked in AND literally nothing was
        # found, which almost always means every package failed to load (a real, diagnosable
        # problem -- check the log for the actual bazel errors), not that the query pattern simply
        # matched nothing.
        warnings.append(
            "No targets were found and bazel reported errors loading packages -- this usually "
            "means every package failed to load (an unresolved dependency, a Bazel-version "
            "mismatch, or a broken BUILD/WORKSPACE/MODULE.bazel file). Check the log below for "
            "the actual error."
        )
    elif partial:
        warnings.append(
            "bazel query completed with errors on some packages (--keep_going) -- results may be incomplete"
        )

    return {
        "commitSha": commit_sha,
        "warnings": warnings,
        "targetsByKind": targets_by_kind,
        "totalTargets": total_targets,
        "totalPackages": len(packages),
        "externalDeps": [{"repoName": repo, "version": None} for repo in sorted(external_repos)],
        "packageGraph": {
            "nodes": nodes,
            "edges": [{"source": s, "target": t} for s, t in sorted(edges)],
            "truncated": truncated,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--partial", choices=["true", "false"], required=True)
    args = parser.parse_args()

    results = [json.loads(line) for line in sys.stdin if line.strip()]
    result = parse_query_result(results, commit_sha=args.commit_sha, partial=args.partial == "true")
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
