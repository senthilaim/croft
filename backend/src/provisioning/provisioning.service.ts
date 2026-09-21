import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BuildfarmEdge,
  BuildfarmInstance,
  BuildfarmNode,
  InfraStats,
  InfraTrendSeries,
} from '@croft/shared-types';

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
    nodes: BuildfarmNode[],
    edges: BuildfarmEdge[],
  ): Promise<BuildfarmInstance> {
    const res = await this.callAutomation('/provision', {
      workspaceId,
      nodes,
      edges,
    });
    return res as BuildfarmInstance;
  }

  async teardown(workspaceId: string): Promise<BuildfarmInstance> {
    const res = await this.callAutomation('/teardown', { workspaceId });
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
