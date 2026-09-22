import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from parse_query import _label_to_package_id, parse_query_result  # noqa: E402


def rule(name, rule_class, deps=None):
    attrs = []
    if deps:
        attrs.append({"name": "deps", "type": "LABEL_LIST", "stringListValue": deps})
    return {"type": "RULE", "rule": {"name": name, "ruleClass": rule_class, "attribute": attrs}}


def test_label_to_package_id_internal():
    assert _label_to_package_id("//foo/bar:baz") == "//foo/bar"
    assert _label_to_package_id("//foo/bar") == "//foo/bar"


def test_label_to_package_id_external_workspace_style():
    assert _label_to_package_id("@boost//:boost") == "@boost"
    assert _label_to_package_id("@boost//sub/pkg:target") == "@boost"


def test_label_to_package_id_external_bzlmod_canonical():
    # Newer canonical form uses "+", older used "~" -- both should collapse to the bare repo name
    # so different pinned versions of the same dependency don't appear as separate graph nodes.
    assert _label_to_package_id("@@boost+1.87.0//:boost") == "@boost"
    assert _label_to_package_id("@@rules_go~0.50.0//go:def.bzl") == "@rules_go"


def test_histogram_and_package_counts():
    results = [
        rule("//lib:util", "cc_library"),
        rule("//lib:core", "cc_library", deps=["//lib:util"]),
        rule("//app:server", "cc_binary", deps=["//lib:core"]),
        rule("//app:server_test", "cc_test", deps=["//lib:core"]),
    ]
    result = parse_query_result(results, commit_sha="abc123", partial=False)
    assert result["targetsByKind"] == {"cc_library": 2, "cc_binary": 1, "cc_test": 1}
    assert result["totalTargets"] == 4
    assert result["totalPackages"] == 2  # //lib and //app
    assert result["commitSha"] == "abc123"
    assert result["warnings"] == []


def test_partial_flag_adds_a_warning():
    result = parse_query_result([], commit_sha="x", partial=True)
    assert len(result["warnings"]) == 1
    assert "keep_going" in result["warnings"][0]


def test_package_graph_drops_self_edges_and_collapses_external_deps():
    results = [
        # Two targets in the same package depending on each other -- must not produce a
        # self-edge on //lib.
        rule("//lib:a", "cc_library", deps=["//lib:b"]),
        rule("//lib:b", "cc_library"),
        # Two different versions of the same external dep -- must collapse to one node/edge.
        rule("//app:server", "cc_binary", deps=["@boost//:boost", "@@boost+1.87.0//:system"]),
    ]
    result = parse_query_result(results, commit_sha="x", partial=False)
    node_ids = {n["id"] for n in result["packageGraph"]["nodes"]}
    assert node_ids == {"//lib", "//app", "@boost"}
    edges = {(e["source"], e["target"]) for e in result["packageGraph"]["edges"]}
    assert ("//lib", "//lib") not in edges
    assert ("//app", "@boost") in edges
    assert len(edges) == 1  # both boost deps collapsed into a single edge
    assert result["externalDeps"] == [{"repoName": "@boost", "version": None}]
    assert result["packageGraph"]["truncated"] is False


def test_target_count_per_package_node():
    results = [
        rule("//lib:a", "cc_library"),
        rule("//lib:b", "cc_library"),
        rule("//lib:c", "cc_test"),
    ]
    result = parse_query_result(results, commit_sha="x", partial=False)
    lib_node = next(n for n in result["packageGraph"]["nodes"] if n["id"] == "//lib")
    assert lib_node["targetCount"] == 3


def test_large_graph_is_truncated_to_the_most_connected_nodes():
    # Build a star graph: //hub depends on 400 leaf packages. //hub should always survive
    # truncation (highest degree); some leaves are dropped.
    results = [rule("//hub:main", "cc_binary", deps=[f"//leaf{i}:t" for i in range(400)])]
    results += [rule(f"//leaf{i}:t", "cc_library") for i in range(400)]
    result = parse_query_result(results, commit_sha="x", partial=False)
    graph = result["packageGraph"]
    assert graph["truncated"] is True
    assert len(graph["nodes"]) == 300
    assert any(n["id"] == "//hub" for n in graph["nodes"])
    # totals reflect the *real* repo, not the truncated view.
    assert result["totalPackages"] == 401


def test_unknown_rule_class_falls_back_gracefully():
    results = [{"type": "RULE", "rule": {"name": "//x:y", "attribute": []}}]
    result = parse_query_result(results, commit_sha="x", partial=False)
    assert result["targetsByKind"] == {"unknown": 1}


def test_non_rule_results_are_ignored():
    results = [
        {"type": "PACKAGE_GROUP", "packageGroup": {"name": "//visibility:public"}},
        rule("//lib:a", "cc_library"),
    ]
    result = parse_query_result(results, commit_sha="x", partial=False)
    assert result["totalTargets"] == 1
