import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Build as BuildDto } from '@bazel-bootstrap/shared-types';
import { Build, BuildDocument } from './schemas/build.schema.js';
import { isSuccessExitCode, type BuildEventJson } from './bep-parser.js';

@Injectable()
export class BuildsService {
  constructor(@InjectModel(Build.name) private readonly buildModel: Model<BuildDocument>) {}

  /** Applies a single live BEP event, relayed from automation's BES gRPC server. */
  async ingestEvent(workspaceId: string, event: BuildEventJson): Promise<void> {
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

    // Non-"started" events don't carry the invocation id, so they apply to the most recent
    // build for this workspace (sequential builds per workspace). Not filtered to status
    // "running": buildMetrics arrives *after* finished in Bazel's own event order, once
    // finished has already flipped the status to success/failure.
    const current = await this.buildModel.findOne({ workspaceId }).sort({ startTime: -1 });
    if (!current) return;

    const label = event.id?.targetCompleted?.label;
    if (label && event.completed) {
      current.targets = current.targets.filter((t) => t.label !== label);
      current.targets.push({
        label,
        status: event.completed.success ? 'success' : 'failure',
        durationMs: 0,
      });
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

    if (event.finished) {
      current.status = isSuccessExitCode(event.finished.exitCode) ? 'success' : 'failure';
      current.endTime = event.finished.finishTime ?? new Date().toISOString();
      current.totalDurationMs = Math.max(
        0,
        new Date(current.endTime).getTime() - new Date(current.startTime).getTime(),
      );
      current.errorMessage = event.finished.errorMessage ?? null;
      await current.save();
    }
  }

  findAllForWorkspace(workspaceId: string, limit = 50): Promise<BuildDocument[]> {
    return this.buildModel
      .find({ workspaceId })
      .sort({ startTime: -1 })
      .limit(limit)
      .exec();
  }

  findOne(workspaceId: string, buildId: string): Promise<BuildDocument | null> {
    return this.buildModel.findOne({ _id: buildId, workspaceId }).exec();
  }
}

export function toBuildDto(doc: BuildDocument): BuildDto {
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
  };
}
