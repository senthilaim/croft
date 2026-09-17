# Sample Bazel project

This project is wired to the Buildfarm provisioned for the "UAT" workspace,
listening at `localhost:20007`.

## Build remotely

    bazel build //:hello

The .bazelrc in this directory already points Bazel at your Buildfarm, so this build runs
on the remote worker instead of your machine.

## Verify it actually ran remotely

    cat bazel-bin/hello.txt

You can also check the worker's logs to see it pick up the action:

    docker logs workspace-<workspaceId>-worker-1 --tail 50

## Live build analytics dashboard

No extra command needed -- the same `bazel build //:hello` above also streams this build's
progress (targets starting and completing, pass/fail, duration) LIVE to your workspace's
dashboard as it happens, via the `--bes_backend` flags already set in .bazelrc. Open the
workspace's Dashboard page in the app before or during the build to watch it update.
