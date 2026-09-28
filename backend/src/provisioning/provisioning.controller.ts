import {
  BadRequestException,
  Controller,
  Logger,
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

// Matches AwsBackend.GRPC_PORT (automation/app/backends/aws_backend.py) -- used only for the
// "provisioning" placeholder instance returned immediately below, before the real instance (with
// its real host) exists.
const AWS_GRPC_PORT = 8980;

type DecryptedCloudCredential = NonNullable<Awaited<ReturnType<CloudCredentialsService['getDecryptedSecret']>>>;

@Controller('workspaces/:id/buildfarm')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class ProvisioningController {
  private readonly logger = new Logger(ProvisioningController.name);

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
    const nodes = config.nodes as unknown as BuildfarmNode[];
    const issues = validateTopology(nodes, config.edges);
    if (issues.length > 0) {
      throw new BadRequestException({ message: 'Invalid buildfarm topology', issues });
    }

    if (config.provider === 'aws') {
      const decrypted = await this.cloudCredentialsService.getDecryptedSecret(workspace.id);
      if (!decrypted) {
        throw new BadRequestException('Connect an AWS account under Settings > Cloud before provisioning');
      }
      await this.buildfarmConfigService.setStatus(workspace.id, 'provisioning');
      // `terraform apply` can take minutes for a VPC + EC2 instance -- return immediately with a
      // "provisioning" placeholder (mirrors RepoAnalysisService.startAnalysis()'s pattern) and let
      // the frontend poll GET .../status and GET .../log for progress, rather than holding this
      // request open the whole time.
      const awsCredential = this.toAwsCredentialPayload(decrypted);
      void this.runInBackground('provision', workspace.id, () =>
        this.provisioningService.submit(workspace.id, 'aws', nodes, config.edges, awsCredential),
      );
      return this.provisioningPlaceholder(workspace.id);
    }

    await this.buildfarmConfigService.setStatus(workspace.id, 'provisioning');
    try {
      const instance = await this.provisioningService.submit(workspace.id, config.provider, nodes, config.edges);
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

    if (decrypted) {
      // `terraform destroy` can also take a while -- same async-with-log-polling treatment as
      // submit() above.
      const awsCredential = this.toAwsCredentialPayload(decrypted);
      void this.runInBackground('teardown', workspace.id, () =>
        this.provisioningService.teardown(workspace.id, awsCredential),
      );
      return this.provisioningPlaceholder(workspace.id);
    }

    const instance = await this.provisioningService.teardown(workspace.id);
    await this.buildfarmConfigService.setStatus(workspace.id, 'stopped');
    return instance;
  }

  @Get('status')
  async status(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmInstance> {
    const instance = await this.provisioningService.status(workspace.id);
    if (!instance) throw new NotFoundException('No buildfarm instance for this workspace');
    return instance;
  }

  @Get('log')
  async log(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<{ log: string }> {
    return { log: await this.provisioningService.provisionLog(workspace.id) };
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

  private toAwsCredentialPayload(decrypted: DecryptedCloudCredential): AwsCredentialPayload {
    return {
      roleArn: decrypted.doc.roleArn,
      externalId: decrypted.doc.externalId,
      bootstrapAccessKeyId: decrypted.doc.bootstrapAccessKeyId,
      bootstrapSecretAccessKey: decrypted.bootstrapSecretAccessKey,
      region: decrypted.doc.region,
      allowedIngressCidrs: decrypted.doc.allowedIngressCidrs,
    };
  }

  private provisioningPlaceholder(workspaceId: string): BuildfarmInstance {
    return {
      workspaceId,
      provider: 'aws',
      ports: { grpc: AWS_GRPC_PORT },
      host: null,
      status: 'provisioning',
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Runs a long AWS provision/teardown call without blocking the HTTP response that kicked it
   * off -- this method's own promise is deliberately never awaited by its caller (see the `void
   * this.runInBackground(...)` call sites above). It persists its own outcome (buildfarm-config
   * status), so nothing about the call is silently lost even though no one is waiting on it. */
  private async runInBackground(
    kind: 'provision' | 'teardown',
    workspaceId: string,
    call: () => Promise<BuildfarmInstance>,
  ): Promise<void> {
    try {
      const instance = await call();
      await this.buildfarmConfigService.setStatus(workspaceId, instance.status);
    } catch (err) {
      this.logger.warn(`AWS ${kind} failed for workspace ${workspaceId}: ${String(err)}`);
      await this.buildfarmConfigService.setStatus(workspaceId, 'error');
    }
  }
}
