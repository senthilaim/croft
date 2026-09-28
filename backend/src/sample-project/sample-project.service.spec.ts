import { describe, expect, it } from 'vitest';
import { buildBazelrc, buildConnectConfig, buildReadme } from './sample-project.service.js';

describe('buildBazelrc -- host threading', () => {
  it('with host="localhost" (Docker), every address is localhost -- zero behavior change from before this field existed', () => {
    const rc = buildBazelrc('ws1', 'localhost', 20001, 9095, true, 'tok');
    expect(rc).toContain('build --remote_executor=grpc://localhost:20001');
    expect(rc).toContain('build --remote_cache=grpc://localhost:20001');
    expect(rc).toContain('build --bes_backend=grpc://localhost:9095');
  });

  it('with a real host (AWS), only the Buildfarm addresses (remote_executor/remote_cache) move -- bes_backend stays local to wherever Croft itself runs, which is unrelated to where the Buildfarm was provisioned', () => {
    const rc = buildBazelrc('ws1', '52.1.2.3', 20001, 9095, true, 'tok');
    expect(rc).toContain('build --remote_executor=grpc://52.1.2.3:20001');
    expect(rc).toContain('build --remote_cache=grpc://52.1.2.3:20001');
    expect(rc).toContain('test --remote_executor=grpc://52.1.2.3:20001');
    expect(rc).toContain('test --remote_cache=grpc://52.1.2.3:20001');
    // The BES ingest port is Croft's own automation service, not the Buildfarm -- it doesn't
    // move just because the Buildfarm did.
    expect(rc).toContain('build --bes_backend=grpc://localhost:9095');
    expect(rc).toContain('test --bes_backend=grpc://localhost:9095');
    expect(rc).not.toContain('52.1.2.3:9095');
  });

  it('cache-only (executionEnabled: false) omits remote_executor but still moves remote_cache to the given host', () => {
    const rc = buildBazelrc('ws1', '52.1.2.3', 20001, 9095, false, 'tok');
    expect(rc).not.toContain('remote_executor');
    expect(rc).toContain('build --remote_cache=grpc://52.1.2.3:20001');
  });
});

describe('buildConnectConfig / buildReadme -- host threading', () => {
  it('buildConnectConfig threads host into the generated .bazelrc', () => {
    const config = buildConnectConfig('ws1', '52.1.2.3', 20001, 9095, true, null, 'tok');
    expect(config.bazelrc).toContain('grpc://52.1.2.3:20001');
  });

  it('buildReadme reports the given host, not a hardcoded localhost', () => {
    const readme = buildReadme('My Workspace', '52.1.2.3', 20001, true);
    expect(readme).toContain('listening at `52.1.2.3:20001`');
  });
});
