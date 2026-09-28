import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  CloudCredential as CloudCredentialDto,
  CloudCredentialSetupInfo,
  ConnectCloudCredentialRequest,
} from '@croft/shared-types';
import { TokenCipherService } from '../crypto/token-cipher.service.js';
import { buildRolePolicyJson, buildTrustPolicyJson } from './aws-policy-templates.js';
import { CloudCredential, CloudCredentialDocument } from './schemas/cloud-credential.schema.js';

// This release's staging posture (see the plan's "Staging-only first release" section): tight
// enough that the safety rail can't be disabled by submitting an extreme value, but the actual
// value within this range is still the customer's own choice from the connect form.
const IDLE_TIMEOUT_MIN_MINUTES = 30;
const IDLE_TIMEOUT_MAX_MINUTES = 240;

// Matches the one region the staging cost-estimator catalog and Terraform module support this
// release (see cost-estimator.ts / the plan's "Out of scope" section).
const SUPPORTED_REGION = 'us-east-1';

function toDto(doc: CloudCredentialDocument): CloudCredentialDto {
  return {
    workspaceId: doc.workspaceId,
    provider: doc.provider,
    environment: doc.environment,
    roleArn: doc.roleArn,
    externalId: doc.externalId,
    bootstrapAccessKeyId: doc.bootstrapAccessKeyId,
    bootstrapKeyLast4: doc.bootstrapKeyLast4,
    region: doc.region,
    idleTimeoutMinutes: doc.idleTimeoutMinutes,
    allowedIngressCidrs: doc.allowedIngressCidrs,
    connectedBy: doc.connectedBy,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (doc as unknown as { updatedAt: Date }).updatedAt.toISOString(),
  };
}

@Injectable()
export class CloudCredentialsService {
  constructor(
    @InjectModel(CloudCredential.name) private readonly model: Model<CloudCredentialDocument>,
    private readonly tokenCipher: TokenCipherService,
    private readonly configService: ConfigService,
  ) {}

  /** Stable per-workspace setup material for the credentials-connect UI -- safe to compute and
   * show before any credential exists, since the External ID isn't a secret. */
  getSetupInfo(workspaceId: string): CloudCredentialSetupInfo {
    const externalId = this.tokenCipher.deriveExternalId(workspaceId);
    return {
      externalId,
      trustPolicyJson: buildTrustPolicyJson(externalId),
      rolePolicyJson: buildRolePolicyJson(),
    };
  }

  async connect(
    workspaceId: string,
    userId: string,
    request: ConnectCloudCredentialRequest,
  ): Promise<CloudCredentialDto> {
    if (request.environment !== 'staging') {
      throw new BadRequestException('Only the staging environment is supported this release');
    }
    if (request.region !== SUPPORTED_REGION) {
      throw new BadRequestException(`Only the ${SUPPORTED_REGION} region is supported this release`);
    }
    if (
      !Number.isFinite(request.idleTimeoutMinutes) ||
      request.idleTimeoutMinutes < IDLE_TIMEOUT_MIN_MINUTES ||
      request.idleTimeoutMinutes > IDLE_TIMEOUT_MAX_MINUTES
    ) {
      throw new BadRequestException(
        `Idle timeout must be between ${IDLE_TIMEOUT_MIN_MINUTES} and ${IDLE_TIMEOUT_MAX_MINUTES} minutes`,
      );
    }
    if (!request.allowedIngressCidrs || request.allowedIngressCidrs.length === 0) {
      throw new BadRequestException('At least one allowed ingress CIDR is required');
    }
    if (request.allowedIngressCidrs.includes('0.0.0.0/0')) {
      throw new BadRequestException('0.0.0.0/0 is not allowed -- scope ingress to specific CIDR ranges');
    }
    if (!request.roleArn || !request.bootstrapAccessKeyId || !request.bootstrapSecretAccessKey) {
      throw new BadRequestException('Role ARN and bootstrap access key are required');
    }

    const externalId = this.tokenCipher.deriveExternalId(workspaceId);
    // Confirms the role is actually assumable with this key before anything is encrypted and
    // persisted -- mirrors RepoConnectionService.connect()'s fetchGitHubRepoInfo-before-encrypt
    // pattern.
    await this.validateAssumeRole(request, externalId);

    const encrypted = this.tokenCipher.encrypt(request.bootstrapSecretAccessKey);

    const doc = await this.model.findOneAndUpdate(
      { workspaceId, provider: 'aws', environment: request.environment },
      {
        workspaceId,
        provider: 'aws',
        environment: request.environment,
        roleArn: request.roleArn,
        externalId,
        bootstrapAccessKeyId: request.bootstrapAccessKeyId,
        bootstrapSecretCiphertext: encrypted.ciphertext,
        bootstrapSecretIv: encrypted.iv,
        bootstrapSecretAuthTag: encrypted.authTag,
        bootstrapKeyLast4: request.bootstrapAccessKeyId.slice(-4),
        region: request.region,
        idleTimeoutMinutes: request.idleTimeoutMinutes,
        allowedIngressCidrs: request.allowedIngressCidrs,
        connectedBy: userId,
      },
      { upsert: true, new: true },
    );
    return toDto(doc);
  }

  async getConnection(workspaceId: string): Promise<CloudCredentialDto | null> {
    const doc = await this.model.findOne({ workspaceId, provider: 'aws', environment: 'staging' }).exec();
    return doc ? toDto(doc) : null;
  }

  async disconnect(workspaceId: string): Promise<void> {
    await this.model.deleteOne({ workspaceId, provider: 'aws', environment: 'staging' }).exec();
  }

  /** Every AWS staging credential across all workspaces -- used only by IdleTimeoutService to find
   * which workspaces to check each tick; no other caller needs a cross-workspace listing. */
  listAllStagingCredentials(): Promise<CloudCredentialDocument[]> {
    return this.model.find({ provider: 'aws', environment: 'staging' }).exec();
  }

  /** For internal use only (AwsBackend provisioning calls) -- never exposed through a controller
   * response. */
  async getDecryptedSecret(
    workspaceId: string,
  ): Promise<{ doc: CloudCredentialDocument; bootstrapSecretAccessKey: string } | null> {
    const doc = await this.model.findOne({ workspaceId, provider: 'aws', environment: 'staging' }).exec();
    if (!doc) return null;
    try {
      const bootstrapSecretAccessKey = this.tokenCipher.decrypt({
        ciphertext: doc.bootstrapSecretCiphertext,
        iv: doc.bootstrapSecretIv,
        authTag: doc.bootstrapSecretAuthTag,
      });
      return { doc, bootstrapSecretAccessKey };
    } catch {
      throw new BadRequestException(
        'This cloud credential can no longer be read. Reconnect it with a new bootstrap key.',
      );
    }
  }

  private async validateAssumeRole(
    request: ConnectCloudCredentialRequest,
    externalId: string,
  ): Promise<void> {
    const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/credentials/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': this.configService.getOrThrow<string>('AUTOMATION_INTERNAL_TOKEN'),
        },
        body: JSON.stringify({
          roleArn: request.roleArn,
          externalId,
          bootstrapAccessKeyId: request.bootstrapAccessKeyId,
          bootstrapSecretAccessKey: request.bootstrapSecretAccessKey,
          region: request.region,
        }),
      });
    } catch {
      throw new BadGatewayException('Could not reach the automation service');
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new BadRequestException(body.detail ?? 'This role could not be assumed with the given credentials');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new BadGatewayException(`Automation service error: ${text}`);
    }
  }
}
