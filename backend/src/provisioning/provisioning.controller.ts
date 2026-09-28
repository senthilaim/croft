import {
  BadRequestException,
  Controller,
  NotFoundException,
  Post,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  BuildfarmInstance,
  BuildfarmNode,
  InfraStats,
  InfraTrendSeries,
} from '@croft/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { WorkspaceRoleGuard } from '../workspaces/workspace-role.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { BuildfarmConfigService } from '../buildfarm-config/buildfarm-config.service.js';
import { validateTopology } from '../buildfarm-config/buildfarm-topology.js';
import { CloudCredentialsService } from '../cloud-credentials/cloud-credentials.service.js';
import { ProvisioningService, type AwsCredentialPayload } from './provisioning.service.js';

@Controller('workspaces/:id/buildfarm')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class ProvisioningController {
  constructor(
    private readonly provisioningService: ProvisioningService,
    private readonly buildfarmConfigService: BuildfarmConfigService,
    private readonly cloudCredentialsService: CloudCredentialsService,
  ) {}

  // Spinning real infrastructure up/down is the most consequential action in the app -- the first
  // (deliberately narrow, see the plan) place a 'viewer' role actually means something.
  @Post('submit')
  @UseGuards(WorkspaceRoleGuard('owner', 'admin', 'member'))
  async submit(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmInstance> {
    const config = await this.buildfarmConfigService.getOrCreateDraft(workspace.id);
    const issues = validateTopology(config.nodes as unknown as BuildfarmNode[], config.edges);
    if (issues.length > 0) {
      throw new BadRequestException({ message: 'Invalid buildfarm topology', issues });
    }

    let awsCredential: AwsCredentialPayload | undefined;
    if (config.provider === 'aws') {
      const decrypted = await this.cloudCredentialsService.getDecryptedSecret(workspace.id);
      if (!decrypted) {
        throw new BadRequestException('Connect an AWS account under Settings > Cloud before provisioning');
      }
      awsCredential = {
        roleArn: decrypted.doc.roleArn,
        externalId: decrypted.doc.externalId,
        bootstrapAccessKeyId: decrypted.doc.bootstrapAccessKeyId,
        bootstrapSecretAccessKey: decrypted.bootstrapSecretAccessKey,
        region: decrypted.doc.region,
        allowedIngressCidrs: decrypted.doc.allowedIngressCidrs,
      };
    }

    await this.buildfarmConfigService.setStatus(workspace.id, 'provisioning');
    try {
      const instance = await this.provisioningService.submit(
        workspace.id,
        config.provider,
        config.nodes as unknown as BuildfarmNode[],
        config.edges,
        awsCredential,
      );
      await this.buildfarmConfigService.setStatus(workspace.id, instance.status);
      return instance;
    } catch (err) {
      await this.buildfarmConfigService.setStatus(workspace.id, 'error');
      throw err;
    }
  }

  @Post('teardown')
  @UseGuards(WorkspaceRoleGuard('owner', 'admin', 'member'))
  async teardown(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmInstance> {
    // Which credential (if any) to send is decided here, not by asking automation first -- a
    // Docker workspace never has one connected, and automation's own persisted buildfarm_instances
    // document (not this request) is what actually decides which backend handles the teardown.
    const decrypted = await this.cloudCredentialsService.getDecryptedSecret(workspace.id);
    const awsCredential: AwsCredentialPayload | undefined = decrypted
      ? {
          roleArn: decrypted.doc.roleArn,
          externalId: decrypted.doc.externalId,
          bootstrapAccessKeyId: decrypted.doc.bootstrapAccessKeyId,
          bootstrapSecretAccessKey: decrypted.bootstrapSecretAccessKey,
          region: decrypted.doc.region,
          allowedIngressCidrs: decrypted.doc.allowedIngressCidrs,
        }
      : undefined;

    const instance = await this.provisioningService.teardown(workspace.id, awsCredential);
    await this.buildfarmConfigService.setStatus(workspace.id, 'stopped');
    return instance;
  }

  @Get('status')
  async status(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmInstance> {
    const instance = await this.provisioningService.status(workspace.id);
    if (!instance) throw new NotFoundException('No buildfarm instance for this workspace');
    return instance;
  }

  @Get('infra')
  infra(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<InfraStats> {
    return this.provisioningService.infra(workspace.id);
  }

  @Get('infra/trends')
  infraTrends(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Query('hours') hours?: string,
  ): Promise<InfraTrendSeries[]> {
    const parsed = Number.parseInt(hours ?? '', 10);
    const clamped = Number.isFinite(parsed) ? Math.min(168, Math.max(1, parsed)) : 24;
    return this.provisioningService.infraTrends(workspace.id, clamped);
  }
}
