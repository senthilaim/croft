import { BadGatewayException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RepoAnalysisResult } from '@croft/shared-types';
import { diagnoseAnalysisFailure } from './analysis-diagnostics.js';
import { LiveBus } from '../live/live-bus.js';
import { suggestBuildfarmNodes } from './infra-heuristic.js';
import { RepoConnectionService } from './repo-connection.service.js';

// Comfortably above automation's own DEFAULT_TIMEOUT_SECONDS (repo_analysis.py), so the client
// only times out after automation would have already given up and reported a clean error.
const CLIENT_TIMEOUT_MS = 11 * 60 * 1000;
const LOG_POLL_INTERVAL_MS = 2000;

interface AutomationAnalysisPayload {
  commitSha: string | null;
  warnings: string[];
  targetsByKind: Record<string, number>;
  totalTargets: number;
  totalPackages: number;
  externalDeps: RepoAnalysisResult['externalDeps'];
  packageGraph: RepoAnalysisResult['packageGraph'];
}

/** Carries the sandboxed job's console output alongside the failure message, so a failure is
 * diagnosable (what actually broke) instead of just "exit 1". */
class AnalysisCallError extends Error {
  constructor(
    message: string,
    readonly logTail: string | null,
  ) {
    super(message);
  }
}

function emptyResultFields() {
  return {
    warnings: [] as string[],
    targetsByKind: {} as Record<string, number>,
    totalTargets: 0,
    totalPackages: 0,
    externalDeps: [] as RepoAnalysisResult['externalDeps'],
    packageGraph: { nodes: [], edges: [], truncated: false } as RepoAnalysisResult['packageGraph'],
    suggestedNodes: [] as RepoAnalysisResult['suggestedNodes'],
  };
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
      logTail: null,
      diagnosis: null,
      ...emptyResultFields(),
    };
    await this.repoConnectionService.saveAnalysis(workspaceId, running);
    this.liveBus.repoAnalysisChanged(workspaceId);

    void this.runInBackground(workspaceId, running.startedAt);
    return running;
  }

  private async runInBackground(workspaceId: string, startedAt: string): Promise<void> {
    let lastLogTail: string | null = null;
    const pollLog = async () => {
      const tail = await this.fetchLogTail(workspaceId);
      if (tail && tail !== lastLogTail) {
        lastLogTail = tail;
        await this.repoConnectionService.updateAnalysisLog(workspaceId, tail);
        this.liveBus.repoAnalysisChanged(workspaceId);
      }
    };
    // Polls the sandbox container's live console output concurrently with the long-running
    // analyze call below -- docker logs can be read from a container while it's still attached
    // to the process that launched it, so this doesn't require automation to run the job
    // asynchronously.
    const logTimer = setInterval(() => void pollLog(), LOG_POLL_INTERVAL_MS);

    try {
      const connection = await this.repoConnectionService.getDecryptedToken(workspaceId);
      if (!connection) throw new AnalysisCallError('Repository connection was removed while the job ran', null);

      const payload = await this.callAutomation(workspaceId, connection.doc, connection.token);
      const result: RepoAnalysisResult = {
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        commitSha: payload.commitSha,
        errorMessage: null,
        logTail: lastLogTail,
        // A "succeeded" run that found nothing is still worth diagnosing -- e.g. every package
        // failed to load, which is functionally a failure even though bazel query itself exited
        // cleanly (via --keep_going). The real evidence lives in the console log, not `warnings`.
        diagnosis: payload.totalTargets === 0 ? diagnoseAnalysisFailure(null, lastLogTail) : null,
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
      // Prefer the error's own log tail (captured at the moment the job actually exited) over the
      // last live poll, which could be a cycle or two stale.
      const logTail = err instanceof AnalysisCallError && err.logTail ? err.logTail : lastLogTail;
      const errorMessage = err instanceof Error ? err.message : 'Analysis failed';
      const failed: RepoAnalysisResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        commitSha: null,
        errorMessage,
        logTail,
        diagnosis: diagnoseAnalysisFailure(errorMessage, logTail),
        ...emptyResultFields(),
      };
      await this.repoConnectionService.saveAnalysis(workspaceId, failed);
    } finally {
      clearInterval(logTimer);
      this.liveBus.repoAnalysisChanged(workspaceId);
    }
  }

  private async fetchLogTail(workspaceId: string): Promise<string | null> {
    try {
      const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
      const res = await fetch(`${baseUrl}/analyze/${workspaceId}/log`, {
        headers: { 'X-Internal-Token': this.configService.getOrThrow<string>('AUTOMATION_INTERNAL_TOKEN') },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { log?: string };
      return body.log || null;
    } catch {
      return null; // best-effort: a missed poll just means the log panel updates a beat later.
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
      throw new AnalysisCallError(`Could not reach the automation service: ${String(err)}`, null);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      const message =
        typeof body?.detail?.message === 'string' ? body.detail.message : (body?.message ?? 'Analysis failed');
      const logTail = typeof body?.detail?.logTail === 'string' ? body.detail.logTail : null;
      throw new AnalysisCallError(message, logTail);
    }
    return (await res.json()) as AutomationAnalysisPayload;
  }
}
