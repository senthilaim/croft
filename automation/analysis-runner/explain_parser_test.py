import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from explain_parser import parse_explain_log  # noqa: E402

# Captured for real: a minimal cc_binary (//:app depending on //:core), built twice inside the
# actual croft-analysis-runner sandbox image with both builds in one container invocation (so
# Bazel's local action cache genuinely persisted between them), core.cc appended with a single
# newline in between. The second build reported "2 processes: 1 action cache hit, 1 internal" --
# i.e. only the workspace-status action (always unconditional) and core.cc's compile re-ran;
# main.cc's compile and the link step stayed cached, exactly as a real incremental edit should
# behave.
REAL_EXPLAIN_LOG = """\
Build options: --flag_alias='build_python_zip=@@rules_python+//python/config_settings:build_python_zip' --explain=/tmp/explain.log --verbose_explanations
Executing action 'BazelWorkspaceStatusAction stable-status.txt': unconditional execution is requested.
Executing action 'Compiling core.cc': action changed since cached execution.
"""


def test_real_captured_incremental_build_log():
    result = parse_explain_log(REAL_EXPLAIN_LOG)
    assert result["totalActionsRebuilt"] == 2
    assert result["unparsedLines"] == []  # the "Build options:" line must not leak through

    descriptions = {a["description"] for a in result["rebuiltActions"]}
    assert descriptions == {"BazelWorkspaceStatusAction stable-status.txt", "Compiling core.cc"}

    by_desc = {a["description"]: a for a in result["rebuiltActions"]}
    assert by_desc["Compiling core.cc"]["category"] == "changed"
    assert by_desc["BazelWorkspaceStatusAction stable-status.txt"]["category"] == "unconditional"
    assert result["countsByCategory"] == {"unconditional": 1, "changed": 1}


def test_cold_build_actions_are_categorized_as_new():
    # A from-scratch build: every action is a first-time cache miss, not a real "this rebuilt
    # because you changed it" signal -- distinct from "changed" so the UI doesn't mislabel a cold
    # build as if every action were caused by the file edit.
    log = "Executing action 'Linking app': no entry in the cache (action is new).\n"
    result = parse_explain_log(log)
    assert result["rebuiltActions"][0]["category"] == "new"


def test_runfiles_line_shape_is_parsed():
    # Distinct message shape from a regular action ("Executing runfiles for X: reason." -- no
    # "action" keyword) -- observed in the same real capture as the action lines above.
    log = "Executing runfiles for //:app: no entry in the cache (action is new).\n"
    result = parse_explain_log(log)
    assert result["totalActionsRebuilt"] == 1
    assert result["rebuiltActions"][0]["description"] == "//:app"
    assert result["rebuiltActions"][0]["category"] == "new"


def test_unrecognized_line_is_preserved_not_dropped():
    log = "Some future Bazel version's explain message Croft has never seen.\n"
    result = parse_explain_log(log)
    assert result["totalActionsRebuilt"] == 0
    assert result["unparsedLines"] == ["Some future Bazel version's explain message Croft has never seen."]


def test_no_action_needed_is_the_empty_case():
    # A second build with zero relevant changes (e.g. a no-op edit outside the dep graph) --
    # nothing to explain, not an error.
    result = parse_explain_log("")
    assert result["totalActionsRebuilt"] == 0
    assert result["rebuiltActions"] == []
    assert result["countsByCategory"] == {}
