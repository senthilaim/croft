import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FileContent, FileGroup, FileGroupId } from '@croft/shared-types';
import { BuildfarmConfigService } from '../buildfarm-config/buildfarm-config.service.js';
import { DEMO_FILES, type SourceFile } from '../demo/demo-source.js';
import { DemoService } from '../demo/demo.service.js';
import { computeBesIngestToken } from '../live/bes-ingest-token.js';
import { ProvisioningService } from '../provisioning/provisioning.service.js';
import {
  buildAlwaysFailsTestScript,
  buildBazelrc,
  buildBuildFile,
  buildFlakyTestScript,
  buildModuleBazel,
  buildStableTestScript,
} from '../sample-project/sample-project.service.js';

const MAX_FILE_BYTES = 512 * 1024;

interface Collected {
  id: FileGroupId;
  label: string;
  description: string;
  files: SourceFile[];
}

/**
 * Read-only view over files Croft itself knows about. There is deliberately no path taken from the
 * request that touches the filesystem: every group is assembled in memory from a fixed set of
 * generators or a fixed allow-list of names, and lookups are by exact match against that set.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly provisioningService: ProvisioningService,
    private readonly buildfarmConfigService: BuildfarmConfigService,
    private readonly demoService: DemoService,
    private readonly configService: ConfigService,
  ) {}

  private async collect(workspaceId: string): Promise<Collected[]> {
    const groups: Collected[] = [];

    const deployed = await this.provisioningService.deployedFiles(workspaceId);
    if (deployed.length > 0) {
      groups.push({
        id: 'deployed',
        label: 'Deployed Buildfarm',
        description: 'What Croft generated and started for this workspace.',
        files: deployed.map((f) => ({ path: f.name, content: f.content })),
      });
    }

    const sample: SourceFile[] = [
      { path: 'MODULE.bazel', content: buildModuleBazel() },
      { path: 'BUILD.bazel', content: buildBuildFile() },
      { path: 'stable_test.sh', content: buildStableTestScript() },
      { path: 'always_fails_test.sh', content: buildAlwaysFailsTestScript() },
      { path: 'flaky_test.sh', content: buildFlakyTestScript() },
    ];
    const instance = await this.provisioningService.status(workspaceId).catch(() => null);
    if (instance?.ports?.grpc) {
      const config = await this.buildfarmConfigService.getOrCreateDraft(workspaceId);
      const worker = config.nodes.find((n) => n.type === 'worker');
      const executionEnabled =
        (worker?.config as { executionEnabled?: boolean } | undefined)?.executionEnabled ?? true;
      const besPort = Number(this.configService.get<string>('BES_PORT', '9095'));
      const besToken = computeBesIngestToken(workspaceId, this.configService.getOrThrow<string>('BES_INGEST_SECRET'));
      sample.push({
        path: '.bazelrc',
        content: buildBazelrc(workspaceId, instance.ports.grpc, besPort, executionEnabled, besToken),
      });
    }
    groups.push({
      id: 'sample',
      label: 'Sample project',
      description: 'The Bazel project offered on the Sample project page.',
      files: sample,
    });

    if ((await this.demoService.count(workspaceId)) > 0) {
      groups.push({
        id: 'demo',
        label: 'Demo project (demo-shop)',
        description: 'Sources the demo failures point at. Open a failure to jump to its line.',
        files: DEMO_FILES,
      });
    }
    return groups;
  }

  async list(workspaceId: string): Promise<FileGroup[]> {
    return (await this.collect(workspaceId)).map((g) => ({
      id: g.id,
      label: g.label,
      description: g.description,
      files: g.files.map((f) => ({ path: f.path, sizeBytes: Buffer.byteLength(f.content) })),
    }));
  }

  async read(workspaceId: string, group: string, path: string): Promise<FileContent | null> {
    const found = (await this.collect(workspaceId))
      .find((g) => g.id === group)
      ?.files.find((f) => f.path === path);
    if (!found) return null;
    const content =
      Buffer.byteLength(found.content) > MAX_FILE_BYTES
        ? found.content.slice(0, MAX_FILE_BYTES) + '\n… (truncated)'
        : found.content;
    return {
      group: group as FileGroupId,
      path,
      content,
      lineCount: content.replace(/\n$/, '').split('\n').length,
    };
  }
}
