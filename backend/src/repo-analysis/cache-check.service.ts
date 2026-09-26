import { BadGatewayException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CacheCheckResult } from '@croft/shared-types';
import { diagnoseAnalysisFailure } from './analysis-diagnostics.js';
import { LiveBus } from '../live/live-bus.js';
import { ProvisioningService } from '../provisioning/provisioning.service.js';
import { RepoConnectionService } from './repo-connection.service.js';

// Same generous headroom reasoning as rebuild-simulation.service.ts -- this job also runs two
// real builds, worst case a fully cold cache costs about the same as that job.
const CLIENT_TIMEOUT_MS = 16 * 60 * 1000;
const LOG_POLL_INTERVAL_MS = 2000;

interface AutomationCacheCheckPayload {
  readCheck: CacheCheckResult['readCheck'];
  roundTripCheck: CacheCheckResult['roundTripCheck'];
}

/** Same reasoning as the other two services' xCallError classes: carries the sandboxed job's
 * console output alongside the failure so it's diagnosable, not just "exit 1". */
class CacheCheckCallError extends Error {
  constructor(
    message: string,
    readonly logTail: string | null,
  ) {
    super(message);
  }
}

const EMPTY_PHASE = { cacheableActions: 0, remoteCacheHits: 0, hitRatePercent: 0, actions: [] };

function emptyResultFields() {
  return {
    readCheck: { ...EMPTY_PHASE } as CacheCheckResult['readCheck'],
    roundTripCheck: { ...EMPTY_PHASE } as CacheCheckResult['roundTripCheck'],
  };
}

/**
 * The one service in this app that deliberately gates a sandboxed job on the workspace's real
 * infrastructure being up (`ProvisioningService.status`) before running it -- because this job,
 * unlike repo analysis or rebuild simulation, actually talks to that infrastructure over the
 * network (see automation/app/cache_check.py's docstring for the full security reasoning).
 */
@Injectable()
export class CacheCheckService {
  private readonly log = new Logger(CacheCheckService.name);

  constructor(
    private readonly repoConnectionService: RepoConnectionService,
    private readonly provisioningService: ProvisioningService,
    private readonly configService: ConfigService,
    private readonly liveBus: LiveBus,
  ) {}

  async getResult(workspaceId: string): Promise<CacheCheckResult | null> {
    return this.repoConnectionService.getCacheCheck(workspaceId);
  }

  /** Kicks off a run and returns immediately (status: "running"), same 202-then-background-poll
   * shape as the other two sandbox-job services. Rejects up front if the workspace's Buildfarm
   * isn't currently running -- there is nothing to check the cache against otherwise. */
  async startCacheCheck(workspaceId: string, target: string): Promise<CacheCheckResult> {
    if (!target?.trim()) throw new BadGatewayException('A Bazel target label is required');

    const existing = await this.repoConnectionService.getCacheCheck(workspaceId);
    if (existing?.status === 'running') {
      throw new ConflictException('A cache check is already running for this workspace');
    }

    const connection = await this.repoConnectionService.getDecryptedToken(workspaceId);
    if (!connection) {
      throw new BadGatewayException('No repository connected for this workspace');
    }

    const instance = await this.provisioningService.status(workspaceId);
    if (!instance || instance.status !== 'running') {
      throw new BadGatewayException('This workspace has no running Buildfarm to check the cache against');
    }

    const running: CacheCheckResult = {
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      target,
      errorMessage: null,
      logTail: null,
      diagnosis: null,
      ...emptyResultFields(),
    };
    await this.repoConnectionService.saveCacheCheck(workspaceId, running);
    this.liveBus.cacheCheckChanged(workspaceId);

    void this.runInBackground(workspaceId, target, instance.ports.grpc, running.startedAt);
    return running;
  }

  private async runInBackground(
    workspaceId: string,
    target: string,
    grpcPort: number,
    startedAt: string,
  ): Promise<void> {
    let lastLogTail: string | null = null;
    const pollLog = async () => {
      const tail = await this.fetchLogTail(workspaceId);
      if (tail && tail !== lastLogTail) {
        lastLogTail = tail;
        await this.repoConnectionService.updateCacheCheckLog(workspaceId, tail);
        this.liveBus.cacheCheckChanged(workspaceId);
      }
    };
    const logTimer = setInterval(() => void pollLog(), LOG_POLL_INTERVAL_MS);

    try {
      const connection = await this.repoConnectionService.getDecryptedToken(workspaceId);
      if (!connection) throw new CacheCheckCallError('Repository connection was removed while the job ran', null);

      const payload = await this.callAutomation(workspaceId, connection.doc, connection.token, target, grpcPort);
      const result: CacheCheckResult = {
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        target,
        errorMessage: null,
        logTail: lastLogTail,
        diagnosis: null,
        readCheck: payload.readCheck,
        roundTripCheck: payload.roundTripCheck,
      };
      await this.repoConnectionService.saveCacheCheck(workspaceId, result);
    } catch (err) {
      this.log.warn(`cache check failed for workspace ${workspaceId}: ${String(err)}`);
      const logTail = err instanceof CacheCheckCallError && err.logTail ? err.logTail : lastLogTail;
      const errorMessage = err instanceof Error ? err.message : 'Cache check failed';
      const failed: CacheCheckResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        target,
        errorMessage,
        logTail,
        // Reuses the general diagnosis engine unchanged -- disk/OOM/timeout/missing-tool/network
        // failures look the same from this job as from the other two sandbox jobs.
        diagnosis: diagnoseAnalysisFailure(errorMessage, logTail),
        ...emptyResultFields(),
      };
      await this.repoConnectionService.saveCacheCheck(workspaceId, failed);
    } finally {
      clearInterval(logTimer);
      this.liveBus.cacheCheckChanged(workspaceId);
    }
  }

  private async fetchLogTail(workspaceId: string): Promise<string | null> {
    try {
      const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
      const res = await fetch(`${baseUrl}/cache-check/${workspaceId}/log`, {
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
    grpcPort: number,
  ): Promise<AutomationCacheCheckPayload> {
    const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
    const repoUrl = `https://github.com/${connection.owner}/${connection.repo}`;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/cache-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': this.configService.getOrThrow<string>('AUTOMATION_INTERNAL_TOKEN'),
        },
        body: JSON.stringify({
          workspaceId,
          repoUrl,
          token,
          branch: connection.defaultBranch,
          target,
          grpcPort,
        }),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch (err) {
      throw new CacheCheckCallError(`Could not reach the automation service: ${String(err)}`, null);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      const message =
        typeof body?.detail?.message === 'string' ? body.detail.message : (body?.message ?? 'Cache check failed');
      const logTail = typeof body?.detail?.logTail === 'string' ? body.detail.logTail : null;
      throw new CacheCheckCallError(message, logTail);
    }
    return (await res.json()) as AutomationCacheCheckPayload;
  }
}
