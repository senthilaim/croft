import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BuildfarmEdge,
  BuildfarmInstance,
  BuildfarmNode,
  BuildfarmProvider,
  InfraStats,
  InfraTrendSeries,
} from '@croft/shared-types';

/** Forwarded to automation's /provision and /teardown -- automation never touches the
 * cloud_credentials collection directly, so NestJS decrypts the bootstrap secret (via
 * CloudCredentialsService) and sends it fresh on every call instead. Field names match
 * automation/app/models.py's AwsCredential exactly. */
export interface AwsCredentialPayload {
  roleArn: string;
  externalId: string;
  bootstrapAccessKeyId: string;
  bootstrapSecretAccessKey: string;
  region: string;
  allowedIngressCidrs: string[];
}

@Injectable()
export class ProvisioningService {
  constructor(private readonly configService: ConfigService) {}

  private get baseUrl(): string {
    return this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Internal-Token': this.configService.getOrThrow<string>('AUTOMATION_INTERNAL_TOKEN'),
    };
  }

  async submit(
    workspaceId: string,
    provider: BuildfarmProvider,
    nodes: BuildfarmNode[],
    edges: BuildfarmEdge[],
    awsCredential?: AwsCredentialPayload,
  ): Promise<BuildfarmInstance> {
    const res = await this.callAutomation('/provision', {
      workspaceId,
      provider,
      nodes,
      edges,
      awsCredential,
    });
    return res as BuildfarmInstance;
  }

  async teardown(workspaceId: string, awsCredential?: AwsCredentialPayload): Promise<BuildfarmInstance> {
    const res = await this.callAutomation('/teardown', { workspaceId, awsCredential });
    return res as BuildfarmInstance;
  }

  async status(workspaceId: string): Promise<BuildfarmInstance | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/status/${workspaceId}`, { headers: this.headers });
    } catch {
      throw new BadGatewayException('Could not reach the automation service');
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      throw new BadGatewayException(`Automation service error: ${body}`);
    }
    return (await res.json()) as BuildfarmInstance;
  }

  async deployedFiles(workspaceId: string): Promise<Array<{ name: string; content: string }>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/files/${workspaceId}`, { headers: this.headers });
    } catch {
      return [];
    }
    if (!res.ok) return [];
    return ((await res.json()) as { files: Array<{ name: string; content: string }> }).files;
  }

  async infra(workspaceId: string): Promise<InfraStats> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/infra/${workspaceId}`, { headers: this.headers });
    } catch {
      throw new BadGatewayException('Could not reach the automation service');
    }
    if (!res.ok) return { containers: [] };
    return (await res.json()) as InfraStats;
  }

  /** Live Terraform output for a workspace's in-flight AWS provision/teardown -- polled
   * concurrently while ProvisioningController's background submit() call is still running.
   * Tolerant of any failure (empty string), same as infra()/deployedFiles(): this is a
   * nice-to-have progress view, not something that should itself surface an error. */
  async provisionLog(workspaceId: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/provision/${workspaceId}/log`, { headers: this.headers });
    } catch {
      return '';
    }
    if (!res.ok) return '';
    const body = (await res.json().catch(() => ({}))) as { log?: string };
    return body.log ?? '';
  }

  async infraTrends(workspaceId: string, hours: number): Promise<InfraTrendSeries[]> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/infra/${workspaceId}/trends?hours=${hours}`, {
        headers: this.headers,
      });
    } catch {
      throw new BadGatewayException('Could not reach the automation service');
    }
    if (!res.ok) return [];
    return (await res.json()) as InfraTrendSeries[];
  }

  private async callAutomation(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new BadGatewayException('Could not reach the automation service');
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        typeof payload === 'object' && payload && 'detail' in payload
          ? JSON.stringify((payload as { detail: unknown }).detail)
          : JSON.stringify(payload);
      throw new BadGatewayException(message);
    }
    return payload;
  }
}
