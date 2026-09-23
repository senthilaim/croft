import { describe, expect, it } from 'vitest';
import { diagnoseAnalysisFailure } from './analysis-diagnostics.js';

// Real log text captured from this session's two actual incidents, not synthesized -- see the
// plan's rationale for using real fixtures where we have them.
const REAL_DISK_FULL_LOG = `
Repository rule _tf_http_archive defined at:
  /tmp/bazel-output/external/xla/third_party/repo.bzl:94:35: in <toplevel>
ERROR: /tmp/bazel-output/external/xla/third_party/repo.bzl:73:33: An error occurred during the fetch of repository 'llvm-raw':
   Traceback (most recent call last):
	File "/tmp/bazel-output/external/xla/third_party/repo.bzl", line 73, column 33, in _tf_http_archive_impl
		ctx.download_and_extract(
Error in download_and_extract: java.io.IOException: Error extracting /tmp/bazel-output/external/llvm-raw/temp8159470937926822186/0038be81b8b5361112faf82e69d4590364ee81b9.tar.gz to /tmp/bazel-output/external/llvm-raw/temp8159470937926822186: write (No space left on device)
ERROR: Error computing the main repository mapping: no such package '@@llvm-raw//utils/bazel': java.io.IOException: Error extracting /tmp/bazel-output/external/llvm-raw/temp8159470937926822186/0038be81b8b5361112faf82e69d4590364ee81b9.tar.gz to /tmp/bazel-output/external/llvm-raw/temp8159470937926822186: write (No space left on device)
`;

const REAL_BZLMOD_LOG = `
Loading: 0 packages loaded
ERROR: error loading package 'python_util': Unable to find package for @@[unknown repo 'rules_python' requested from @@]//python:defs.bzl: The repository '@@[unknown repo 'rules_python' requested from @@]' could not be resolved: No repository visible as '@rules_python' from main repository.
ERROR: error loading package 'java/src/main/java/com/example/cmdline': Unable to find package for @@[unknown repo 'rules_java' requested from @@]//java:defs.bzl: The repository '@@[unknown repo 'rules_java' requested from @@]' could not be resolved: No repository visible as '@rules_java' from main repository.
ERROR: Skipping '//...': no targets found beneath ''
WARNING: --keep_going specified, ignoring errors. Results may be inaccurate
INFO: Empty results
`;

describe('diagnoseAnalysisFailure', () => {
  it('recognizes the real disk-full failure from this session (XLA/llvm-raw)', () => {
    const diagnosis = diagnoseAnalysisFailure(null, REAL_DISK_FULL_LOG);
    expect(diagnosis?.category).toBe('disk');
    expect(diagnosis?.selfServiceable).toBe(false);
  });

  it('recognizes the real bzlmod/WORKSPACE failure from this session', () => {
    const diagnosis = diagnoseAnalysisFailure(null, REAL_BZLMOD_LOG);
    expect(diagnosis?.category).toBe('bazel-version');
    expect(diagnosis?.selfServiceable).toBe(true);
    expect(diagnosis?.recommendedSteps.join(' ')).toContain('.bazelversion');
  });

  it('recognizes a missing system tool', () => {
    const diagnosis = diagnoseAnalysisFailure(null, 'sh: 1: node: not found\nERROR: fetch failed');
    expect(diagnosis?.category).toBe('missing-tool');
    expect(diagnosis?.selfServiceable).toBe(false);
  });

  it('recognizes an out-of-memory kill', () => {
    const diagnosis = diagnoseAnalysisFailure('Analysis failed (exit 137)', 'Killed\n');
    expect(diagnosis?.category).toBe('out-of-memory');
  });

  it('recognizes the exact timeout message run_analysis raises', () => {
    const diagnosis = diagnoseAnalysisFailure('Analysis exceeded the time limit', null);
    expect(diagnosis?.category).toBe('timeout');
  });

  it('recognizes a renamed/deleted branch', () => {
    const diagnosis = diagnoseAnalysisFailure(
      null,
      "fatal: Remote branch main not found in upstream origin\ncouldn't find remote ref main",
    );
    expect(diagnosis?.category).toBe('branch');
    expect(diagnosis?.selfServiceable).toBe(true);
  });

  it('recognizes a rejected/expired token', () => {
    const diagnosis = diagnoseAnalysisFailure(null, 'remote: Repository not found.\nfatal: Authentication failed');
    expect(diagnosis?.category).toBe('auth');
    expect(diagnosis?.selfServiceable).toBe(true);
  });

  it('recognizes network failures that survived automatic retries', () => {
    const diagnosis = diagnoseAnalysisFailure(null, 'could not download Bazel: unexpected EOF');
    expect(diagnosis?.category).toBe('network');
  });

  it('returns null for unrecognized text instead of guessing', () => {
    expect(diagnoseAnalysisFailure('Analysis failed (exit 1)', 'some completely novel error nobody has seen')).toBeNull();
  });

  it('returns null when there is nothing to go on', () => {
    expect(diagnoseAnalysisFailure(null, null)).toBeNull();
  });

  it('checks errorMessage as well as logTail, not just one', () => {
    const diagnosis = diagnoseAnalysisFailure('No space left on device', null);
    expect(diagnosis?.category).toBe('disk');
  });
});
