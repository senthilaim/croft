import { BadRequestException, Controller, ConflictException, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { CiProvider, ConnectConfig, ConnectKit } from '@croft/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { ProvisioningService } from '../provisioning/provisioning.service.js';
import { BuildfarmConfigService } from '../buildfarm-config/buildfarm-config.service.js';
import { SampleProjectService } from './sample-project.service.js';
import { buildConnectKit, isValidHost } from './connect-kit.js';
import { ConfigService } from '@nestjs/config';

@Controller('workspaces/:id/sample-project')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class SampleProjectController {
  constructor(
    private readonly sampleProjectService: SampleProjectService,
    private readonly provisioningService: ProvisioningService,
    private readonly buildfarmConfigService: BuildfarmConfigService,
    private readonly configService: ConfigService,
  ) {}

  @Get('connect-kit')
  async connectKit(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Query('host') host = 'localhost',
    @Query('provider') provider = 'github',
    @Query('runner') runner = 'self-hosted',
  ): Promise<ConnectKit> {
    if (!isValidHost(host)) throw new BadRequestException('Invalid host name or address');
    if (!['github', 'gitlab', 'jenkins'].includes(provider)) {
      throw new BadRequestException('Unknown CI provider');
    }
    const instance = await this.provisioningService.status(workspace.id);
    if (!instance || instance.status !== 'running') {
      throw new ConflictException('Submit setup for this workspace first');
    }
    const config = await this.buildfarmConfigService.getOrCreateDraft(workspace.id);
    const workerNode = config.nodes.find((node) => node.type === 'worker');
    const executionEnabled =
      (workerNode?.config as { executionEnabled?: boolean } | undefined)?.executionEnabled ?? true;
    return buildConnectKit({
      workspaceId: workspace.id,
      host,
      provider: provider as CiProvider,
      grpcPort: instance.ports.grpc,
      besPort: Number(this.configService.get<string>('BES_PORT', '9095')),
      executionEnabled,
      selfHosted: runner !== 'hosted',
    });
  }

  @Get('connect')
  async connect(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<ConnectConfig> {
    const instance = await this.provisioningService.status(workspace.id);
    if (!instance || instance.status !== 'running') {
      throw new ConflictException('Submit setup for this workspace first');
    }
    const config = await this.buildfarmConfigService.getOrCreateDraft(workspace.id);
    const workerNode = config.nodes.find((node) => node.type === 'worker');
    const executionEnabled =
      (workerNode?.config as { executionEnabled?: boolean } | undefined)?.executionEnabled ??
      true;
    return this.sampleProjectService.connectConfig(
      workspace.id,
      instance.ports.grpc,
      executionEnabled,
      instance.platform ?? null,
    );
  }

  @Get()
  async download(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Res() res: Response,
  ): Promise<void> {
    const instance = await this.provisioningService.status(workspace.id);
    if (!instance || instance.status !== 'running') {
      throw new ConflictException(
        'Submit setup for this workspace before downloading the sample project',
      );
    }

    const config = await this.buildfarmConfigService.getOrCreateDraft(workspace.id);
    const workerNode = config.nodes.find((node) => node.type === 'worker');
    const executionEnabled =
      (workerNode?.config as { executionEnabled?: boolean } | undefined)?.executionEnabled ??
      true;

    const archive = this.sampleProjectService.createZip(
      workspace.id,
      workspace.name,
      instance.ports.grpc,
      executionEnabled,
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="buildfarm-sample-project.zip"');
    archive.pipe(res);
  }
}
