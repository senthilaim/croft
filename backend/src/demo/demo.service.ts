import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Build, BuildDocument } from '../builds/schemas/build.schema.js';
import { TestRun, TestRunDocument } from '../builds/schemas/test-run.schema.js';
import { LiveBus } from '../live/live-bus.js';
import { generateDemoData } from './demo-data.js';

@Injectable()
export class DemoService {
  constructor(
    @InjectModel(Build.name) private readonly buildModel: Model<BuildDocument>,
    @InjectModel(TestRun.name) private readonly testRunModel: Model<TestRunDocument>,
    private readonly liveBus: LiveBus,
  ) {}

  count(workspaceId: string): Promise<number> {
    return this.buildModel.countDocuments({ workspaceId, demo: true }).exec();
  }

  async clear(workspaceId: string): Promise<void> {
    await Promise.all([
      this.buildModel.deleteMany({ workspaceId, demo: true }).exec(),
      this.testRunModel.deleteMany({ workspaceId, demo: true }).exec(),
    ]);
    this.liveBus.buildsChanged(workspaceId);
  }

  /** Replaces any previous demo data so repeating the demo never piles up duplicates. */
  async seed(workspaceId: string): Promise<{ builds: number; testRuns: number }> {
    await this.clear(workspaceId);
    const { builds, testRuns } = generateDemoData();

    const created = await this.buildModel.insertMany(builds.map((b) => ({ ...b, workspaceId })));
    await this.testRunModel.insertMany(
      testRuns.map((t) => ({
        workspaceId,
        invocationId: t.invocationId,
        buildId: created[t.buildIndex].id,
        label: t.label,
        status: t.status,
        runCount: t.runCount,
        totalDurationMs: t.totalDurationMs,
        startTime: t.startTime,
        demo: true,
      })),
    );
    this.liveBus.buildsChanged(workspaceId);
    return { builds: builds.length, testRuns: testRuns.length };
  }
}
