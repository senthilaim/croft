import { BadGatewayException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RepoAnalysisResult } from '@croft/shared-types';
import { LiveBus } from '../live/live-bus.js';
import { suggestBuildfarmNodes } from './infra-heuristic.js';
import { RepoConnectionService } from './repo-connection.service.js';

// Comfortably above automation's own DEFAULT_TIMEOUT_SECONDS (repo_analysis.py), so the client
// only times out after automation would have already given up and reported a clean error.
const CLIENT_TIMEOUT_MS = 11 * 60 * 1000;

interface AutomationAnalysisPayload {
  commitSha: string | null;
  warnings: string[];
  targetsByKind: Record<string, number>;
  totalTargets: number;
  totalPackages: number;
  externalDeps: RepoAnalysisResult['externalDeps'];
  packageGraph: RepoAnalysisResult['packageGraph'];
}

@Injectable()
export class RepoAnalysisService {
  private readonly log = new Logger(RepoAnalysisService.name);

  constructor(
    private readonly repoConnectionService: RepoConnectionService,
    private readonly configService: ConfigService,
    private readonly liveBus: LiveBus,
  ) {}

  async getResult(workspaceId: string): Promise<RepoAnalysisResult | null> {
    return this.repoConnectionService.getAnalysis(workspaceId);
  }

  /** Kicks off a run and returns immediately (status: "running") -- the job itself can take
   * minutes, so the HTTP request that triggers it must not block on it. Call without awaiting;
   * this method persists its own success/failure, nothing is left unhandled. */
  async startAnalysis(workspaceId: string): Promise<RepoAnalysisResult> {
    const existing = await this.repoConnectionService.getAnalysis(workspaceId);
    if (existing?.status === 'running') {
      throw new ConflictException('An analysis is already running for this workspace');
    }

    const connection = await this.repoConnectionService.getDecryptedToken(workspaceId);
    if (!connection) {
      throw new BadGatewayException('No repository connected for this workspace');
    }

    const running: RepoAnalysisResult = {
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      commitSha: null,
      errorMessage: null,
      warnings: [],
      targetsByKind: {},
      totalTargets: 0,
      totalPackages: 0,
      externalDeps: [],
      packageGraph: { nodes: [], edges: [], truncated: false },
      suggestedNodes: [],
    };
    await this.repoConnectionService.saveAnalysis(workspaceId, running);
    this.liveBus.repoAnalysisChanged(workspaceId);

    void this.runInBackground(workspaceId, running.startedAt);
    return running;
  }

  private async runInBackground(workspaceId: string, startedAt: string): Promise<void> {
    try {
      const connection = await this.repoConnectionService.getDecryptedToken(workspaceId);
      if (!connection) throw new Error('Repository connection was removed while the job ran');

      const payload = await this.callAutomation(workspaceId, connection.doc, connection.token);
      const result: RepoAnalysisResult = {
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        commitSha: payload.commitSha,
        errorMessage: null,
        warnings: payload.warnings,
        targetsByKind: payload.targetsByKind,
        totalTargets: payload.totalTargets,
        totalPackages: payload.totalPackages,
        externalDeps: payload.externalDeps,
        packageGraph: payload.packageGraph,
        suggestedNodes: suggestBuildfarmNodes(payload.targetsByKind),
      };
      await this.repoConnectionService.saveAnalysis(workspaceId, result);
    } catch (err) {
      this.log.warn(`analysis failed for workspace ${workspaceId}: ${String(err)}`);
      const failed: RepoAnalysisResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        commitSha: null,
        errorMessage: err instanceof Error ? err.message : 'Analysis failed',
        warnings: [],
        targetsByKind: {},
        totalTargets: 0,
        totalPackages: 0,
        externalDeps: [],
        packageGraph: { nodes: [], edges: [], truncated: false },
        suggestedNodes: [],
      };
      await this.repoConnectionService.saveAnalysis(workspaceId, failed);
    } finally {
      this.liveBus.repoAnalysisChanged(workspaceId);
    }
  }

  private async callAutomation(
    workspaceId: string,
    connection: { owner: string; repo: string; defaultBranch: string },
    token: string,
  ): Promise<AutomationAnalysisPayload> {
    const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
    const repoUrl = `https://github.com/${connection.owner}/${connection.repo}`;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': this.configService.getOrThrow<string>('AUTOMATION_INTERNAL_TOKEN'),
        },
        body: JSON.stringify({ workspaceId, repoUrl, token, branch: connection.defaultBranch }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Could not reach the automation service: ${String(err)}`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(typeof body?.detail?.message === 'string' ? body.detail.message : (body?.message ?? 'Analysis failed'));
    }
    return (await res.json()) as AutomationAnalysisPayload;
  }
}
