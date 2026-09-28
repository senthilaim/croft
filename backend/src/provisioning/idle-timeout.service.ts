import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BuildfarmConfigService } from '../buildfarm-config/buildfarm-config.service.js';
import { BuildsService } from '../builds/builds.service.js';
import { CloudCredentialsService } from '../cloud-credentials/cloud-credentials.service.js';
import { ProvisioningService, type AwsCredentialPayload } from './provisioning.service.js';

// Frequent enough that a workspace tears down reasonably close to its own configured
// idleTimeoutMinutes (30-240 min this release), rare enough not to hammer automation with a
// status poll per connected AWS workspace on every tick. No @nestjs/schedule dependency --
// setInterval + OnModuleInit/OnModuleDestroy is the same pattern already used for the other
// background loops in this app (live.gateway.ts's per-connection infra poll, automation's own
// infra_sampler on the Python side).
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * AWS-only: Docker workspaces run on the user's own machine, so "idle" isn't Croft's cost or
 * problem to manage the same way. Reads each workspace's own idleTimeoutMinutes from its
 * CloudCredential rather than one global value (see the plan's "All configuration in UI"
 * principle -- this was the second plan rejection's explicit feedback).
 */
@Injectable()
export class IdleTimeoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdleTimeoutService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly cloudCredentialsService: CloudCredentialsService,
    private readonly provisioningService: ProvisioningService,
    private readonly buildfarmConfigService: BuildfarmConfigService,
    private readonly buildsService: BuildsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.checkAll(), CHECK_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async checkAll(): Promise<void> {
    const credentials = await this.cloudCredentialsService.listAllStagingCredentials();
    for (const credential of credentials) {
      try {
        await this.checkOne(credential.workspaceId, credential.idleTimeoutMinutes);
      } catch (err) {
        // One workspace's failure (e.g. automation briefly unreachable) must not stop the tick
        // from checking every other workspace.
        this.logger.warn(`Idle-timeout check failed for workspace ${credential.workspaceId}: ${String(err)}`);
      }
    }
  }

  private async checkOne(workspaceId: string, idleTimeoutMinutes: number): Promise<void> {
    const instance = await this.provisioningService.status(workspaceId);
    if (!instance || instance.provider !== 'aws' || instance.status !== 'running') return;

    const lastBuildStartTime = await this.buildsService.findLatestStartTime(workspaceId);
    // No build yet since this instance came up -- measure from when it was last updated (set by
    // AwsBackend.provision() on success) rather than tearing it down the moment the check interval
    // first runs.
    const idleSince = new Date(lastBuildStartTime ?? instance.updatedAt);
    const idleMinutes = (Date.now() - idleSince.getTime()) / 60_000;
    if (idleMinutes < idleTimeoutMinutes) return;

    this.logger.log(
      `Tearing down idle AWS Buildfarm for workspace ${workspaceId} (idle ${Math.round(idleMinutes)}m >= ${idleTimeoutMinutes}m)`,
    );

    const decrypted = await this.cloudCredentialsService.getDecryptedSecret(workspaceId);
    if (!decrypted) return; // disconnected between listing and now -- nothing to tear down with

    const awsCredential: AwsCredentialPayload = {
      roleArn: decrypted.doc.roleArn,
      externalId: decrypted.doc.externalId,
      bootstrapAccessKeyId: decrypted.doc.bootstrapAccessKeyId,
      bootstrapSecretAccessKey: decrypted.bootstrapSecretAccessKey,
      region: decrypted.doc.region,
      allowedIngressCidrs: decrypted.doc.allowedIngressCidrs,
    };
    await this.provisioningService.teardown(workspaceId, awsCredential);
    await this.buildfarmConfigService.setStatus(workspaceId, 'stopped');
  }
}
