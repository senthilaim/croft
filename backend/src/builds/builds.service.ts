import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import type {
  Build as BuildDto,
  BuildSummary,
  BuildTrendPoint,
  TestGridRow,
  TestRunEntry,
  TestRunStatus,
} from '@croft/shared-types';
import { Build, BuildDocument } from './schemas/build.schema.js';
import { TestRun, TestRunDocument } from './schemas/test-run.schema.js';
import { isSuccessExitCode, type BuildEventJson } from './bep-parser.js';
import { diagnoseBuild } from './build-diagnostics.js';
import { LiveBus } from '../live/live-bus.js';

const MAX_ARTIFACTS_PER_BUILD = 300;

interface TrendAggregationRow {
  _id: string;
  buildCount: number;
  avgDurationMs: number;
  successCount: number;
  totalActionsExecuted: number;
  totalRemoteCacheHits: number;
}

const TEST_GRID_RUN_WINDOW = 20;

interface TestGridAggregationRow {
  _id: string;
  runs: TestRunEntry[];
}

@Injectable()
export class BuildsService {
  constructor(
    @InjectModel(Build.name) private readonly buildModel: Model<BuildDocument>,
    @InjectModel(TestRun.name) private readonly testRunModel: Model<TestRunDocument>,
    private readonly configService: ConfigService,
    private readonly liveBus: LiveBus,
  ) {}

  /** Applies a single live BEP event, relayed from automation's BES gRPC server. */
  async ingestEvent(workspaceId: string, event: BuildEventJson): Promise<void> {
    await this.applyEvent(workspaceId, event);
    this.liveBus.buildsChanged(workspaceId);
  }

  private async applyEvent(workspaceId: string, event: BuildEventJson): Promise<void> {
    if (event.started?.uuid) {
      await this.buildModel.updateOne(
        { invocationId: event.started.uuid },
        {
          $setOnInsert: {
            workspaceId,
            invocationId: event.started.uuid,
            targets: [],
            totalDurationMs: 0,
            endTime: null,
            errorMessage: null,
            actionsCreated: 0,
            actionsExecuted: 0,
            remoteCacheHits: 0,
            actions: [],
            waterfall: [],
            consoleLog: null,
            artifacts: [],
          },
          $set: {
            command: event.started.command ?? 'build',
            startTime: event.started.startTime ?? new Date().toISOString(),
            status: 'running',
          },
        },
        { upsert: true },
      );
      return;
    }

    // Every event carries Bazel's own build UUID (StreamId.invocation_id, relayed as
    // invocationId) except "started" itself, which uses its own uuid field for the same value --
    // so this always resolves to the one build this event actually belongs to, even with
    // multiple concurrent builds in the same workspace. workspaceId stays as a defense-in-depth
    // filter. Not filtered to status "running": buildMetrics arrives *after* finished in Bazel's
    // own event order, once finished has already flipped the status to success/failure.
    if (!event.invocationId) return;
    const current = await this.buildModel.findOne({
      invocationId: event.invocationId,
      workspaceId,
    });
    if (!current) return;

    const label = event.id?.targetCompleted?.label;
    if (label && event.completed) {
      current.targets = current.targets.filter((t) => t.label !== label);
      current.targets.push({
        label,
        status: event.completed.success ? 'success' : 'failure',
        durationMs: 0,
      });
      if (event.artifacts?.length) {
        const withUri = event.artifacts.filter(
          (a): a is Required<typeof a> => !!(a.targetLabel && a.name && a.uri),
        );
        current.artifacts.push(
          ...withUri.map((a) => ({
            targetLabel: a.targetLabel,
            name: a.name,
            sizeBytes: a.sizeBytes ?? 0,
            uri: a.uri,
          })),
        );
        if (current.artifacts.length > MAX_ARTIFACTS_PER_BUILD) {
          current.artifacts = current.artifacts.slice(0, MAX_ARTIFACTS_PER_BUILD);
        }
      }
      await current.save();
      return;
    }

    if (event.consoleUpdate) {
      if (event.consoleUpdate.consoleLog) current.consoleLog = event.consoleUpdate.consoleLog;
      if (!current.errorMessage && event.consoleUpdate.errorMessage) {
        current.errorMessage = event.consoleUpdate.errorMessage;
      }
      await current.save();
      return;
    }

    if (event.buildMetrics) {
      const m = event.buildMetrics;
      current.actionsCreated = m.actionsCreated ?? 0;
      current.actionsExecuted = m.actionsExecuted ?? 0;
      current.remoteCacheHits = m.remoteCacheHits ?? 0;
      await current.save();
      return;
    }

    if (event.action) {
      const a = event.action;
      current.actions.push({
        label: a.label ?? null,
        mnemonic: a.mnemonic ?? '',
        exitCode: a.exitCode ?? 0,
        commandLine: a.commandLine ?? [],
        primaryOutputPath: a.primaryOutputPath ?? null,
        startTime: a.startTime ?? null,
        endTime: a.endTime ?? null,
        stdout: a.stdout ?? null,
        stderr: a.stderr ?? null,
      });
      await current.save();
      return;
    }

    if (event.waterfall) {
      current.waterfall = event.waterfall.map((s) => ({
        name: s.name ?? '',
        category: s.category ?? '',
        lane: s.lane ?? '',
        startMs: s.startMs ?? 0,
        durationMs: s.durationMs ?? 0,
      }));
      await current.save();
      return;
    }

    if (event.testSummary) {
      const t = event.testSummary;
      if (t.label) {
        await this.testRunModel.updateOne(
          { invocationId: event.invocationId, label: t.label },
          {
            $set: {
              workspaceId: current.workspaceId,
              buildId: current.id,
              status: (t.status ?? 'failed') as TestRunStatus,
              runCount: t.runCount ?? 0,
              totalDurationMs: t.totalDurationMs ?? 0,
              startTime: current.startTime,
            },
          },
          { upsert: true },
        );
      }
      return;
    }

    if (event.finished) {
      current.status = isSuccessExitCode(event.finished.exitCode) ? 'success' : 'failure';
      current.endTime = event.finished.finishTime ?? new Date().toISOString();
      current.totalDurationMs = Math.max(
        0,
        new Date(current.endTime).getTime() - new Date(current.startTime).getTime(),
      );
      current.errorMessage = event.finished.errorMessage ?? null;
      current.consoleLog = event.finished.consoleLog ?? null;
      await current.save();
    }
  }

  findAllForWorkspace(workspaceId: string, limit = 200): Promise<BuildDocument[]> {
    return this.buildModel
      .find({ workspaceId })
      .sort({ startTime: -1 })
      .limit(limit)
      .exec();
  }

  countSince(workspaceId: string, sinceIso: string): Promise<number> {
    return this.buildModel.countDocuments({ workspaceId, startTime: { $gte: sinceIso } }).exec();
  }

  findOne(workspaceId: string, buildId: string): Promise<BuildDocument | null> {
    return this.buildModel.findOne({ _id: buildId, workspaceId }).exec();
  }

  /** Daily build-count/duration/success/cache-hit-rate trend, bucketed on startTime (not
   * createdAt) since that's the build's actual time, not when its Mongo doc happened to be
   * created. */
  async getTrends(workspaceId: string, days: number): Promise<BuildTrendPoint[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const rows = await this.buildModel.aggregate<TrendAggregationRow>([
      { $match: { workspaceId, startTime: { $gte: since.toISOString() } } },
      {
        $addFields: {
          day: { $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$startTime' } } },
        },
      },
      {
        $group: {
          _id: '$day',
          buildCount: { $sum: 1 },
          avgDurationMs: { $avg: '$totalDurationMs' },
          successCount: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          totalActionsExecuted: { $sum: '$actionsExecuted' },
          totalRemoteCacheHits: { $sum: '$remoteCacheHits' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return rows.map((row) => ({
      date: row._id,
      buildCount: row.buildCount,
      avgDurationMs: Math.round(row.avgDurationMs),
      successRate: Math.round((row.successCount / row.buildCount) * 100),
      cacheHitRate:
        row.totalActionsExecuted > 0
          ? Math.round((row.totalRemoteCacheHits / row.totalActionsExecuted) * 100)
          : null,
    }));
  }

  /** One row per distinct test label, newest runs first, flaky rows surfaced first. "Flaky" here
   * means the outcome varies *between* invocations -- Bazel's own per-invocation "flaky" status
   * (a retry within one run) is just one of the statuses that can appear in that mixed history. */
  async getTestGrid(workspaceId: string): Promise<TestGridRow[]> {
    const rows = await this.testRunModel.aggregate<TestGridAggregationRow>([
      { $match: { workspaceId } },
      { $sort: { startTime: -1 } },
      {
        $group: {
          _id: '$label',
          runs: {
            $push: {
              status: '$status',
              startTime: '$startTime',
              totalDurationMs: '$totalDurationMs',
              buildId: '$buildId',
            },
          },
        },
      },
      { $project: { runs: { $slice: ['$runs', TEST_GRID_RUN_WINDOW] } } },
    ]);

    const grid = rows.map((row) => {
      const runs = row.runs;
      const hasPassed = runs.some((r) => r.status === 'passed');
      const hasNonPassed = runs.some((r) => r.status !== 'passed');
      return {
        label: row._id,
        runs,
        isFlaky: hasPassed && hasNonPassed,
        lastStatus: runs[0]?.status ?? 'no_status',
      };
    });

    return grid.sort((a, b) => {
      if (a.isFlaky !== b.isFlaky) return a.isFlaky ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }

  /** Fetches one build artifact's bytes fresh from automation (which fetches them fresh from
   * Buildfarm's CAS via cas_client.py) -- never persisted, only the {name, uri, sizeBytes}
   * metadata is. Null on any failure (automation unreachable, blob evicted), same "degrade, don't
   * throw" contract as the rest of this CAS-backed data. */
  async fetchArtifactBytes(uri: string): Promise<Buffer | null> {
    const baseUrl = this.configService.getOrThrow<string>('AUTOMATION_SERVICE_URL');
    const token = this.configService.getOrThrow<string>('AUTOMATION_INTERNAL_TOKEN');
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/artifacts?uri=${encodeURIComponent(uri)}`, {
        headers: { 'X-Internal-Token': token },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
}

export function toBuildSummaryDto(doc: BuildDocument): BuildSummary {
  let failure: BuildSummary['failure'] = null;
  if (doc.status === 'failure') {
    const [first] = diagnoseBuild([doc.consoleLog, doc.errorMessage, ...doc.actions.map((a) => a.stderr)]);
    if (first) {
      failure = {
        title: first.title,
        category: first.category,
        message: first.message,
        file: first.file,
        line: first.line,
      };
    }
  }
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    invocationId: doc.invocationId,
    command: doc.command,
    startTime: doc.startTime,
    endTime: doc.endTime,
    status: doc.status,
    targets: doc.targets,
    totalDurationMs: doc.totalDurationMs,
    errorMessage: doc.errorMessage,
    actionsCreated: doc.actionsCreated,
    actionsExecuted: doc.actionsExecuted,
    remoteCacheHits: doc.remoteCacheHits,
    failedActionCount: doc.actions.length,
    failure,
  };
}

export function toBuildDto(doc: BuildDocument, includeIssues = false): BuildDto {
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    invocationId: doc.invocationId,
    command: doc.command,
    startTime: doc.startTime,
    endTime: doc.endTime,
    status: doc.status,
    targets: doc.targets,
    totalDurationMs: doc.totalDurationMs,
    errorMessage: doc.errorMessage,
    actionsCreated: doc.actionsCreated,
    actionsExecuted: doc.actionsExecuted,
    remoteCacheHits: doc.remoteCacheHits,
    actions: doc.actions,
    waterfall: doc.waterfall,
    consoleLog: doc.consoleLog,
    artifacts: doc.artifacts.map((a) => ({
      targetLabel: a.targetLabel,
      name: a.name,
      sizeBytes: a.sizeBytes,
    })),
    issues:
      includeIssues && doc.status === 'failure'
        ? diagnoseBuild([doc.consoleLog, doc.errorMessage, ...doc.actions.map((a) => a.stderr)])
        : [],
  };
}
