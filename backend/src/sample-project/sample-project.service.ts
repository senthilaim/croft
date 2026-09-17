import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZipArchive } from 'archiver';

export function buildModuleBazel(): string {
  // sh_test moved out of native builtins into rules_shell in modern Bazel -- needed for the
  // test targets below (BUILD.bazel loads sh_test from here).
  return `module(name = "buildfarm_sample", version = "0.1.0")

bazel_dep(name = "rules_shell", version = "0.8.0")
`;
}

export function buildBuildFile(): string {
  return `load("@rules_shell//shell:sh_test.bzl", "sh_test")

genrule(
    name = "hello",
    outs = ["hello.txt"],
    cmd = "echo 'Hello from Bazel Buildfarm!' > $@",
)

# ---------------------------------------------------------------------------
# A larger example with a real dependency graph (fan-out then fan-in), a slow
# target, and two different kinds of failure -- enough to see every metric on
# the Build analytics dashboard: multiple targets, cache hits, durations, and
# failure reasons. See README.md for how to exercise each one.
# ---------------------------------------------------------------------------

genrule(
    name = "fetch_data",
    outs = ["data.txt"],
    cmd = "echo 'raw-data-123' > $@",
)

genrule(
    name = "transform_upper",
    srcs = [":fetch_data"],
    outs = ["upper.txt"],
    cmd = "tr 'a-z' 'A-Z' < $< > $@",
)

genrule(
    name = "transform_reverse",
    srcs = [":fetch_data"],
    outs = ["reverse.txt"],
    cmd = "rev < $< > $@",
)

genrule(
    name = "transform_count",
    srcs = [":fetch_data"],
    outs = ["count.txt"],
    cmd = "wc -c < $< > $@",
)

genrule(
    name = "combine",
    srcs = [
        ":transform_upper",
        ":transform_reverse",
        ":transform_count",
    ],
    outs = ["combined.txt"],
    cmd = "cat $(SRCS) > $@",
)

genrule(
    name = "report_a",
    srcs = [":combine"],
    outs = ["report_a.txt"],
    cmd = "echo \\"Report A: $$(cat $<)\\" > $@",
)

genrule(
    name = "report_b",
    srcs = [":combine"],
    outs = ["report_b.txt"],
    cmd = "echo \\"Report B: $$(cat $<)\\" > $@",
)

genrule(
    name = "report_c",
    srcs = [":combine"],
    outs = ["report_c.txt"],
    cmd = "echo \\"Report C: $$(cat $<)\\" > $@",
)

genrule(
    name = "slow_task",
    outs = ["slow.txt"],
    cmd = "sleep 3 && echo done > $@",
)

filegroup(
    name = "good_targets",
    srcs = [
        ":report_a",
        ":report_b",
        ":report_c",
        ":slow_task",
    ],
)

# Fails while executing -- shows up on the dashboard with a reason scraped from
# Bazel's own console output ("ERROR: ... Executing genrule //:broken_action failed...").
genrule(
    name = "broken_action",
    outs = ["broken_action.txt"],
    cmd = "echo 'simulated failure' >&2 && exit 1",
)

# Fails during analysis (its srcs reference a file that doesn't exist and nothing
# generates) -- shows up on the dashboard with Bazel's own analysis-error description.
genrule(
    name = "broken_dependency",
    srcs = ["does_not_exist.txt"],
    outs = ["broken_dependency.txt"],
    cmd = "cp $< $@",
)

# ---------------------------------------------------------------------------
# Test targets: stable, always-failing, and flaky. Run each a handful of times to build up
# history on the Test grid -- stable_test stays all-green, always_fails_test all-red, and
# flaky_test's outcome genuinely varies from run to run. See README.md.
# ---------------------------------------------------------------------------

sh_test(
    name = "stable_test",
    srcs = ["stable_test.sh"],
)

sh_test(
    name = "always_fails_test",
    srcs = ["always_fails_test.sh"],
)

sh_test(
    name = "flaky_test",
    srcs = ["flaky_test.sh"],
)
`;
}

export function buildStableTestScript(): string {
  return `#!/bin/bash
exit 0
`;
}

export function buildAlwaysFailsTestScript(): string {
  return `#!/bin/bash
echo "this test always fails, on purpose -- see the Test grid" >&2
exit 1
`;
}

export function buildFlakyTestScript(): string {
  return `#!/bin/bash
# Genuinely random per invocation (not just Bazel's own intra-run retry detection) --
# this is what demonstrates the Test grid's cross-run flakiness detection.
exit $((RANDOM % 2))
`;
}

export function buildBazelrc(
  workspaceId: string,
  grpcPort: number,
  besPort: number,
  executionEnabled: boolean,
): string {
  const executorLine = executionEnabled
    ? `build --remote_executor=grpc://localhost:${grpcPort}\n`
    : `# This workspace's Worker has remote execution disabled -- cache-only mode. Actions run\n` +
      `# on this machine, but read/write the shared remote cache below, so a clean checkout\n` +
      `# elsewhere (or after "bazel clean") can skip re-running work someone else already did.\n`;

  return `${executorLine}build --remote_cache=grpc://localhost:${grpcPort}

# Streams this build's progress live to the workspace's dashboard -- no extra script needed,
# a plain "bazel build" reports live via Bazel's own Build Event Service mechanism.
build --bes_backend=grpc://localhost:${besPort}
build --bes_header=x-workspace-id=${workspaceId}
build --bes_timeout=10s
build --bes_upload_mode=nowait_for_upload_complete

# Bazel's .bazelrc sections are command-specific -- "build" flags above don't apply to
# "bazel test" on their own, so the remote/BES setup is repeated here for the Test grid to work.
${executionEnabled ? `test --remote_executor=grpc://localhost:${grpcPort}\n` : ''}test --remote_cache=grpc://localhost:${grpcPort}
test --bes_backend=grpc://localhost:${besPort}
test --bes_header=x-workspace-id=${workspaceId}
test --bes_timeout=10s
test --bes_upload_mode=nowait_for_upload_complete
# Lets Bazel's own intra-run retry detection ("flaky" status) kick in sometimes, on top of the
# Test grid's separate across-run flakiness detection.
test --flaky_test_attempts=3
# This sample project's tests exist to demonstrate live dashboard/grid data -- caching a result
# would mean re-running "bazel test" shows nothing new, defeating the point.
test --nocache_test_results
`;
}

export function buildReadme(workspaceName: string, grpcPort: number, executionEnabled: boolean): string {
  const buildRemotelySection = executionEnabled
    ? `## Build remotely

    bazel build //:hello

The .bazelrc in this directory already points Bazel at your Buildfarm, so this build runs
on the remote worker instead of your machine.

## Verify it actually ran remotely

    cat bazel-bin/hello.txt

You can also check the worker's logs to see it pick up the action:

    docker logs workspace-<workspaceId>-worker-1 --tail 50`
    : `## Build with a shared remote cache

    bazel build //:hello

This workspace's Worker is in **cache-only mode** (remote execution turned off in its config
panel) -- the action still runs on this machine, but its result is uploaded to the shared
remote cache. Run \`bazel clean\` and build again (or have a teammate build the same target
against this workspace) to see it skip re-running the action entirely:

    bazel clean
    bazel build //:hello   # cache hit -- no re-execution
    cat bazel-bin/hello.txt

Turn "Enable remote execution" back on for the Worker node in the designer and Submit Setup
again if you want remote execution too, not just remote caching.`;

  return `# Sample Bazel project

This project is wired to the Buildfarm provisioned for the "${workspaceName}" workspace,
listening at \`localhost:${grpcPort}\`.

${buildRemotelySection}

## Live build analytics dashboard

No extra command needed -- the same \`bazel build //:hello\` above also streams this build's
progress (targets starting and completing, pass/fail, duration) LIVE to your workspace's
dashboard as it happens, via the \`--bes_backend\` flags already set in .bazelrc. Open the
workspace's Dashboard page in the app before or during a build to watch it update.

## A larger example: multiple targets, cache hits, and real failure reasons

This project also has a bigger target graph (fetch -> 3 parallel transforms -> combine -> 3
reports, plus a slow target) and two intentionally broken targets, so you can see everything
the dashboard tracks:

    # Multiple targets building in parallel with real dependencies between them
    bazel build //:good_targets

    # Kill the Bazel server so the rebuild re-checks the on-disk action cache instead of
    # trusting its in-memory state -- this is what actually produces cache hits on the
    # dashboard (a same-session rebuild skips the check almost entirely and won't show any)
    bazel shutdown
    bazel build //:good_targets

    # Two different failure reasons, both surfaced on the dashboard's "Reason" column
    # straight from Bazel's own console output:
    bazel build //:broken_action        # fails while executing (exit 1)
    bazel build //:broken_dependency    # fails on a missing input file

Each of the four commands above shows up as its own row on the dashboard with its own status,
target count, cache hits/misses, duration, and (for the two failures) a reason.

## Test grid: flaky-test detection across runs

Three test targets, each demonstrating a different pattern on the workspace's **Test grid**
page:

    bazel test //:stable_test //:always_fails_test //:flaky_test

\`stable_test\` always passes and \`always_fails_test\` always fails -- run the command above a
few times and their rows stay solid green / solid red. \`flaky_test\` picks pass or fail at
random each run (\`exit $((RANDOM % 2))\` -- see \`flaky_test.sh\`), on purpose: run the command
**5-10 times** and its row will show a genuine mix, which is what the grid flags as **flaky
across runs** -- a different, more useful signal than Bazel's own single-invocation "flaky"
retry status (also visible here, since \`.bazelrc\` sets \`--flaky_test_attempts=3\`). Results
aren't cached (\`--nocache_test_results\`), so every run reports fresh, live data to the grid.
`;
}

@Injectable()
export class SampleProjectService {
  constructor(private readonly configService: ConfigService) {}

  createZip(
    workspaceId: string,
    workspaceName: string,
    grpcPort: number,
    executionEnabled: boolean,
  ): ZipArchive {
    const besPort = Number(this.configService.get<string>('BES_PORT', '9095'));

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.append(buildModuleBazel(), { name: 'MODULE.bazel' });
    archive.append(buildBuildFile(), { name: 'BUILD.bazel' });
    archive.append(buildBazelrc(workspaceId, grpcPort, besPort, executionEnabled), { name: '.bazelrc' });
    archive.append(buildReadme(workspaceName, grpcPort, executionEnabled), { name: 'README.md' });
    // mode: 0o755 -- Bazel's sandbox runs sh_test srcs directly, so the script needs its
    // executable bit set inside the zip, not just readable.
    archive.append(buildStableTestScript(), { name: 'stable_test.sh', mode: 0o755 });
    archive.append(buildAlwaysFailsTestScript(), { name: 'always_fails_test.sh', mode: 0o755 });
    archive.append(buildFlakyTestScript(), { name: 'flaky_test.sh', mode: 0o755 });
    archive.finalize();
    return archive;
  }
}
