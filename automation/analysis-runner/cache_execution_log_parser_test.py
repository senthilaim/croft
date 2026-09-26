import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cache_execution_log_parser import parse_execution_log  # noqa: E402

# Captured for real: the same minimal cc_binary used for explain_parser_test.py's fixture, built
# twice inside the actual croft-analysis-runner sandbox against a real, freshly-provisioned
# Buildfarm's remote cache (grpc://host.docker.internal:<port>, --remote_instance_name set), each
# build with its OWN fresh --output_base so no local disk cache carries over -- any reported hit is
# unambiguously remote. Trimmed to the fields the parser reads; real field names and values,
# verified against Bazel's actual --execution_log_json_file output, not from docs (that output is
# NOT a JSON array or line-delimited NDJSON -- it's pretty-printed JSON objects concatenated with
# no separator, which is what these fixtures reproduce).
ALL_HITS_LOG = """\
{
  "mnemonic": "CppCompile",
  "targetLabel": "//:app",
  "runner": "remote cache hit",
  "cacheHit": true,
  "cacheable": true,
  "remotable": true,
  "remoteCacheable": true,
  "exitCode": 0
}
{
  "mnemonic": "CppCompile",
  "targetLabel": "//:core",
  "runner": "remote cache hit",
  "cacheHit": true,
  "cacheable": true,
  "remotable": true,
  "remoteCacheable": true,
  "exitCode": 0
}
{
  "mnemonic": "CppLink",
  "targetLabel": "//:app",
  "runner": "remote cache hit",
  "cacheHit": true,
  "cacheable": true,
  "remotable": true,
  "remoteCacheable": true,
  "exitCode": 0
}
"""

# Captured for real too: after a fresh content edit forced a genuine cache miss on one action
# (core.cc's compile), against the same warm Buildfarm -- the middle record's runner is the real
# local-execution strategy name ("processwrapper-sandbox"), not a cache hit.
MIXED_HITS_AND_MISSES_LOG = """\
{
  "mnemonic": "CppCompile",
  "targetLabel": "//:app",
  "runner": "remote cache hit",
  "cacheHit": true,
  "cacheable": true,
  "remotable": true,
  "remoteCacheable": true,
  "exitCode": 0
}
{
  "mnemonic": "CppCompile",
  "targetLabel": "//:core",
  "runner": "processwrapper-sandbox",
  "cacheHit": false,
  "cacheable": true,
  "remotable": true,
  "remoteCacheable": true,
  "exitCode": 0
}
{
  "mnemonic": "CppLink",
  "targetLabel": "//:app",
  "runner": "remote cache hit",
  "cacheHit": true,
  "cacheable": true,
  "remotable": true,
  "remoteCacheable": true,
  "exitCode": 0
}
"""


def test_all_remote_cache_hits():
    result = parse_execution_log(ALL_HITS_LOG)
    assert result["cacheableActions"] == 3
    assert result["remoteCacheHits"] == 3
    assert result["hitRatePercent"] == 100.0
    assert all(a["cacheHit"] for a in result["actions"])
    assert {a["targetLabel"] for a in result["actions"]} == {"//:app", "//:core"}


def test_mixed_hits_and_misses():
    result = parse_execution_log(MIXED_HITS_AND_MISSES_LOG)
    assert result["cacheableActions"] == 3
    assert result["remoteCacheHits"] == 2
    assert result["hitRatePercent"] == 66.7
    miss = next(a for a in result["actions"] if not a["cacheHit"])
    assert miss["runner"] == "processwrapper-sandbox"
    assert miss["mnemonic"] == "CppCompile"
    assert miss["targetLabel"] == "//:core"


def test_non_remote_cacheable_actions_are_excluded_not_counted_as_misses():
    # A purely internal/local action (e.g. a symlink tree) isn't eligible for the remote cache at
    # all -- must not drag the hit rate down as if it were a miss.
    log = """\
{
  "mnemonic": "SourceSymlinkManifest",
  "targetLabel": "//:app",
  "runner": "local",
  "cacheHit": false,
  "cacheable": false,
  "remotable": false,
  "remoteCacheable": false,
  "exitCode": 0
}
"""
    result = parse_execution_log(log)
    assert result["cacheableActions"] == 0
    assert result["remoteCacheHits"] == 0
    assert result["hitRatePercent"] == 0.0
    assert result["actions"] == []


def test_empty_log_is_the_zero_actions_case():
    result = parse_execution_log("")
    assert result["cacheableActions"] == 0
    assert result["remoteCacheHits"] == 0
    assert result["hitRatePercent"] == 0.0
    assert result["actions"] == []


def test_trailing_whitespace_between_concatenated_records_is_tolerated():
    # Real captured logs have newlines between records but no delimiter -- confirm the parser
    # doesn't require records to be perfectly back-to-back.
    log = ALL_HITS_LOG.replace("}\n{", "}\n\n\n{")
    result = parse_execution_log(log)
    assert result["cacheableActions"] == 3
