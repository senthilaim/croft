import { BadGatewayException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RebuildSimulationResult } from '@croft/shared-types';
import { diagnoseAnalysisFailure } from './analysis-diagnostics.js';
import { LiveBus } from '../live/live-bus.js';
import { RepoConnectionService } from './repo-connection.service.js';

// A real build (compilation) runs twice, so this needs more headroom than the analysis job's
// client timeout -- comfortably above automation's own simulation_timeout_seconds default.
const CLIENT_TIMEOUT_MS = 16 * 60 * 1000;
const LOG_POLL_INTERVAL_MS = 2000;

interface AutomationSimulationPayload {
  rebuiltActions: RebuildSimulationResult['rebuiltActions'];
  totalActionsRebuilt: number;
  baselineTotalActions: number;
  countsByCategory: RebuildSimulationResult['countsByCategory'];
}

/** Same reasoning as repo-analysis.service.ts's AnalysisCallError: carries the sandboxed job's
 * console output alongside the failure so it's diagnosable, not just "exit 1". */
class SimulationCallError extends Error {
  constructor(
    message: string,
    readonly logTail: string | null,
  ) {
    super(message);
  }
}

function emptyResultFields() {
  return {
    rebuiltActions: [] as RebuildSimulationResult['rebuiltActions'],
    totalActionsRebuilt: 0,
    baselineTotalActions: 0,
    countsByCategory: {} as RebuildSimulationResult['countsByCategory'],
  };
}

@Injectable()
export class RebuildSimulationService {
  private readonly log = new Logger(RebuildSimulationService.name);

  constructor(
    private readonly repoConnectionService: RepoConnectionService,
    private readonly configService: ConfigService,
    private readonly liveBus: LiveBus,
  ) {}

  async getResult(workspaceId: string): Promise<RebuildSimulationResult | null> {
    return this.repoConnectionService.getSimulation(workspaceId);
  }

  /** Kicks off a run and returns immediately (status: "running") -- mirrors
   * RepoAnalysisService.startAnalysis exactly (same 202-then-background-poll shape). */
  async startSimulation(workspaceId: string, target: string, filePath: string): Promise<RebuildSimulationResult> {
    if (!target?.trim()) throw new BadGatewayException('A Bazel target label is required');
    if (!filePath?.trim()) throw new BadGatewayException('A file path is required');

    const existing = await this.repoConnectionService.getSimulation(workspaceId);
    if (existing?.status === 'running') {
      throw new ConflictException('A rebuild simulation is already running for this workspace');
    }

    const connection = await this.repoConnectionService.getDecryptedToken(workspaceId);
    if (!connection) {
      throw new BadGatewayException('No repository connected for this workspace');
    }

    const running: RebuildSimulationResult = {
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      target,
      filePath,
      errorMessage: null,
      logTail: null,
      diagnosis: null,
      ...emptyResultFields(),
    };
    await this.repoConnectionService.saveSimulation(workspaceId, running);
    this.liveBus.rebuildSimulationChanged(workspaceId);

    void this.runInBackground(workspaceId, target, filePath, running.startedAt);
    return running;
  }

  private async runInBackground(
    workspaceId: string,
    target: string,
    filePath: string,
    startedAt: string,
  ): Promise<void> {
    let lastLogTail: string | null = null;
    const pollLog = async () => {
      const tail = await this.fetchLogTail(workspaceId);
      if (tail && tail !== lastLogTail) {
        lastLogTail = tail;
        await this.repoConnectionService.updateSimulationLog(workspaceId, tail);
        this.liveBus.rebuildSimulationChanged(workspaceId);
      }
    };
    const logTimer = setInterval(() => void pollLog(), LOG_POLL_INTERVAL_MS);

    try {
      const connection = await this.repoConnectionService.getDecryptedToken(workspaceId);
      if (!connection) throw new SimulationCallError('Repository connection was removed while the job ran', null);

      const payload = await this.callAutomation(workspaceId, connection.doc, connection.token, target, filePath);
      const result: RebuildSimulationResult = {
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        target,
        filePath,
        errorMessage: null,
        logTail: lastLogTail,
        diagnosis: null,
        rebuiltActions: payload.rebuiltActions,
        totalActionsRebuilt: payload.totalActionsRebuilt,
        baselineTotalActions: payload.baselineTotalActions,
        countsByCategory: payload.countsByCategory,
      };
      await this.repoConnectionService.saveSimulation(workspaceId, result);
    } catch (err) {
      this.log.warn(`rebuild simulation failed for workspace ${workspaceId}: ${String(err)}`);
      const logTail = err instanceof SimulationCallError && err.logTail ? err.logTail : lastLogTail;
      const errorMessage = err instanceof Error ? err.message : 'Rebuild simulation failed';
      const failed: RebuildSimulationResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        target,
        filePath,
        errorMessage,
        logTail,
        // Reuses the general diagnosis engine unchanged -- disk/OOM/timeout/missing-tool/network
        // failures look the same from a rebuild-simulation job as from an analysis job.
        diagnosis: diagnoseAnalysisFailure(errorMessage, logTail),
        ...emptyResultFields(),
      };
      await this.repoConnectionService.saveSimulation(workspaceId, failed);
    } finally {
      clearInterval(logTimer);
      this.liveBus.rebuildSimulationChanged(workspaceId);
    }
  }

  private async fetchLogTail(workspaceId: string): Promise<string | null> {
    try {
      const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
      const res = await fetch(`${baseUrl}/simulate-rebuild/${workspaceId}/log`, {
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
    target: string,
    filePath: string,
  ): Promise<AutomationSimulationPayload> {
    const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
    const repoUrl = `https://github.com/${connection.owner}/${connection.repo}`;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/simulate-rebuild`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': this.configService.getOrThrow<string>('AUTOMATION_INTERNAL_TOKEN'),
        },
        body: JSON.stringify({ workspaceId, repoUrl, token, branch: connection.defaultBranch, target, filePath }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SimulationCallError(`Could not reach the automation service: ${String(err)}`, null);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      const message =
        typeof body?.detail?.message === 'string'
          ? body.detail.message
          : (body?.message ?? 'Rebuild simulation failed');
      const logTail = typeof body?.detail?.logTail === 'string' ? body.detail.logTail : null;
      throw new SimulationCallError(message, logTail);
    }
    return (await res.json()) as AutomationSimulationPayload;
  }
}
