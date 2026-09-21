import type { CiProvider, ConnectKit, ConnectKitFile } from '@croft/shared-types';

const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

export function isValidHost(host: string): boolean {
  return HOST_RE.test(host);
}

export interface ConnectKitInput {
  workspaceId: string;
  host: string;
  provider: CiProvider;
  grpcPort: number;
  besPort: number;
  executionEnabled: boolean;
  /** GitHub Actions only: run on the repo's own runners instead of GitHub-hosted ones. */
  selfHosted: boolean;
}

/**
 * The remote settings live in a named --config so they only apply in CI (or wherever someone opts in
 * with --config=croft); a developer's local builds are untouched. `test` inherits `build`, so one
 * `build:croft` section covers `bazel build` and `bazel test`.
 */
export function buildCiBazelrc(i: ConnectKitInput): string {
  const grpc = `grpc://${i.host}:${i.grpcPort}`;
  const executor = i.executionEnabled
    ? `build:croft --remote_executor=${grpc}\n`
    : `# Cache-only workspace: actions run on the CI machine and share results through the cache.\n`;
  return `# Croft remote build settings -- enable with:  bazel <build|test> --config=croft
${executor}build:croft --remote_cache=${grpc}
build:croft --remote_timeout=60s
build:croft --remote_retries=3

# Live build analytics in the Croft dashboard.
build:croft --bes_backend=grpc://${i.host}:${i.besPort}
build:croft --bes_header=x-workspace-id=${i.workspaceId}
build:croft --bes_timeout=10s
build:croft --bes_upload_mode=nowait_for_upload_complete
build:croft --build_metadata=ROLE=CI
`;
}

const BAZEL_CMD = 'bazel test //... --config=croft';

function githubWorkflow(selfHosted: boolean): string {
  return `name: bazel-croft

on:
  push:
    branches: [main]
  pull_request:

jobs:
  bazel:
    runs-on: ${selfHosted ? 'self-hosted' : 'ubuntu-latest'}
    steps:
      - uses: actions/checkout@v4
      # Bazelisk is preinstalled on GitHub-hosted runners; install it on self-hosted ones.
      - name: Build and test through Croft
        run: ${BAZEL_CMD}
`;
}

function gitlabCi(): string {
  return `bazel-croft:
  image: ubuntu:24.04
  before_script:
    - apt-get update -qq && apt-get install -y -qq curl git build-essential python3 zip unzip
    - curl -fsSL -o /usr/local/bin/bazel https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-amd64
    - chmod +x /usr/local/bin/bazel
  script:
    - ${BAZEL_CMD}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`;
}

function jenkinsfile(): string {
  return `pipeline {
  agent any
  stages {
    stage('Bazel build and test (Croft)') {
      steps {
        // Assumes bazel/bazelisk is on the agent's PATH.
        sh '${BAZEL_CMD}'
      }
    }
  }
}
`;
}

const CI_FILES: Record<CiProvider, (selfHosted: boolean) => { path: string; description: string; content: string }> = {
  github: (selfHosted) => ({
    path: '.github/workflows/bazel-croft.yml',
    description: 'GitHub Actions workflow that builds and tests through Croft.',
    content: githubWorkflow(selfHosted),
  }),
  gitlab: () => ({
    path: '.gitlab-ci.yml',
    description: 'GitLab CI job (merge into your existing file if you already have one).',
    content: gitlabCi(),
  }),
  jenkins: () => ({
    path: 'Jenkinsfile',
    description: 'Declarative Jenkins pipeline stage that builds and tests through Croft.',
    content: jenkinsfile(),
  }),
};

export function buildConnectKit(i: ConnectKitInput): ConnectKit {
  const files: ConnectKitFile[] = [
    {
      path: '.bazelrc',
      description:
        'Append to your existing .bazelrc. The settings sit under --config=croft, so local builds are unaffected.',
      content: buildCiBazelrc(i),
    },
    CI_FILES[i.provider](i.selfHosted),
  ];

  const warnings: string[] = [];
  if (LOOPBACK.has(i.host.toLowerCase())) {
    warnings.push(
      `"${i.host}" only works from the machine running Croft. CI runners need an address they can reach (a LAN/VPN hostname or IP), otherwise their builds will fail to connect.`,
    );
  }
  if (i.provider === 'github' && !i.selfHosted) {
    warnings.push(
      'GitHub-hosted runners run on the public internet and cannot reach a private Croft. Use a self-hosted runner in the same network, or expose the ports deliberately (see the next warning).',
    );
  }
  warnings.push(
    `The Buildfarm (port ${i.grpcPort}) and build-event (port ${i.besPort}) endpoints have no authentication yet. Keep them on a private network or VPN; do not expose them to the public internet.`,
  );

  return {
    host: i.host,
    provider: i.provider,
    files,
    warnings,
    verifyCommand: 'bazel build //... --config=croft',
  };
}
