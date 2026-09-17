import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { BuildfarmConfigStatus, BuildfarmNodeType } from '@croft/shared-types';

export type BuildfarmConfigDocument = HydratedDocument<BuildfarmConfig>;

@Schema({ _id: false })
export class BuildfarmNodePosition {
  @Prop({ required: true })
  x!: number;

  @Prop({ required: true })
  y!: number;
}
const BuildfarmNodePositionSchema = SchemaFactory.createForClass(BuildfarmNodePosition);

@Schema({ _id: false })
export class BuildfarmNode {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, enum: ['server', 'worker', 'redis', 'cache'] })
  type!: BuildfarmNodeType;

  @Prop({ type: BuildfarmNodePositionSchema, required: true })
  position!: BuildfarmNodePosition;

  @Prop({ type: Object, required: true })
  config!: Record<string, unknown>;
}
const BuildfarmNodeSchema = SchemaFactory.createForClass(BuildfarmNode);

@Schema({ _id: false })
export class BuildfarmEdge {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  source!: string;

  @Prop({ required: true })
  target!: string;
}
const BuildfarmEdgeSchema = SchemaFactory.createForClass(BuildfarmEdge);

@Schema({ timestamps: true })
export class BuildfarmConfig {
  @Prop({ required: true, unique: true })
  workspaceId!: string;

  @Prop({ type: [BuildfarmNodeSchema], default: [] })
  nodes!: BuildfarmNode[];

  @Prop({ type: [BuildfarmEdgeSchema], default: [] })
  edges!: BuildfarmEdge[];

  @Prop({
    required: true,
    enum: ['draft', 'provisioning', 'running', 'error', 'stopped'],
    default: 'draft',
  })
  status!: BuildfarmConfigStatus;
}

export const BuildfarmConfigSchema = SchemaFactory.createForClass(BuildfarmConfig);
