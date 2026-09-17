import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { TestRunStatus } from '@croft/shared-types';

export type TestRunDocument = HydratedDocument<TestRun>;

/**
 * One test target's aggregate result for one invocation -- a top-level collection, not embedded
 * on Build, because the test grid pivots *across* many builds by label; a dedicated indexed
 * collection avoids an expensive cross-document $unwind on every grid render.
 */
@Schema({ timestamps: true })
export class TestRun {
  @Prop({ required: true })
  workspaceId!: string;

  @Prop({ required: true })
  invocationId!: string;

  @Prop({ required: true })
  buildId!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({
    required: true,
    enum: ['passed', 'flaky', 'timeout', 'failed', 'incomplete', 'no_status'],
  })
  status!: TestRunStatus;

  @Prop({ required: true, default: 0 })
  runCount!: number;

  @Prop({ required: true, default: 0 })
  totalDurationMs!: number;

  @Prop({ required: true })
  startTime!: string;
}

export const TestRunSchema = SchemaFactory.createForClass(TestRun);
TestRunSchema.index({ workspaceId: 1, label: 1, startTime: -1 });
// One TestSummary per (invocation, label) -- upserted on this key so a resent event is
// idempotent rather than duplicating a grid row.
TestRunSchema.index({ invocationId: 1, label: 1 }, { unique: true });
