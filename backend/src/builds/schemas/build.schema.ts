import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { BuildStatus } from '@bazel-bootstrap/shared-types';

export type BuildDocument = HydratedDocument<Build>;

@Schema({ _id: false })
export class BuildTargetEntry {
  @Prop({ required: true })
  label!: string;

  @Prop({ required: true, enum: ['running', 'success', 'failure'] })
  status!: BuildStatus;

  @Prop({ required: true, default: 0 })
  durationMs!: number;
}
const BuildTargetSchema = SchemaFactory.createForClass(BuildTargetEntry);

@Schema({ timestamps: true })
export class Build {
  @Prop({ required: true })
  workspaceId!: string;

  @Prop({ required: true, unique: true })
  invocationId!: string;

  @Prop({ required: true })
  command!: string;

  @Prop({ required: true })
  startTime!: string;

  @Prop({ type: String, default: null })
  endTime!: string | null;

  @Prop({ required: true, enum: ['running', 'success', 'failure'] })
  status!: BuildStatus;

  @Prop({ type: [BuildTargetSchema], default: [] })
  targets!: BuildTargetEntry[];

  @Prop({ required: true, default: 0 })
  totalDurationMs!: number;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ required: true, default: 0 })
  actionsCreated!: number;

  @Prop({ required: true, default: 0 })
  actionsExecuted!: number;

  @Prop({ required: true, default: 0 })
  remoteCacheHits!: number;
}

export const BuildSchema = SchemaFactory.createForClass(Build);
BuildSchema.index({ workspaceId: 1, createdAt: -1 });
