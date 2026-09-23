import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type {
  AnalysisDiagnosis,
  ExternalDependency,
  PackageGraph,
  RepoAnalysisStatus,
  RepoProvider,
} from '@croft/shared-types';

export type RepoConnectionDocument = HydratedDocument<RepoConnection>;

// minimize: false -- Mongoose strips empty plain-object fields by default (targetsByKind: {} on a
// pending/running/failed analysis would otherwise vanish from the saved document and come back as
// undefined, not {}), which the frontend can't safely guard against on every read.
@Schema({ _id: false, minimize: false })
export class RepoAnalysisEntry {
  @Prop({ type: String, required: true, enum: ['pending', 'running', 'succeeded', 'failed'] })
  status!: RepoAnalysisStatus;

  @Prop({ required: true })
  startedAt!: string;

  @Prop({ type: String, default: null })
  finishedAt!: string | null;

  @Prop({ type: String, default: null })
  commitSha!: string | null;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ type: String, default: null })
  logTail!: string | null;

  @Prop({ type: Object, default: null })
  diagnosis!: AnalysisDiagnosis | null;

  @Prop({ type: [String], default: [] })
  warnings!: string[];

  @Prop({ type: Object, default: {} })
  targetsByKind!: Record<string, number>;

  @Prop({ required: true, default: 0 })
  totalTargets!: number;

  @Prop({ required: true, default: 0 })
  totalPackages!: number;

  @Prop({ type: [Object], default: [] })
  externalDeps!: ExternalDependency[];

  @Prop({ type: Object, default: { nodes: [], edges: [], truncated: false } })
  packageGraph!: PackageGraph;

  @Prop({ type: [Object], default: [] })
  suggestedNodes!: unknown[];
}
const RepoAnalysisSchema = SchemaFactory.createForClass(RepoAnalysisEntry);

/**
 * One connected repo per workspace (v1). `analysis` holds only the latest run -- re-analyzing
 * overwrites it wholesale, mirroring DemoService's clear-then-replace approach, since nothing here
 * needs trend-over-time and a growing history collection would add pruning burden for no requested
 * value.
 */
@Schema({ timestamps: true })
export class RepoConnection {
  @Prop({ required: true, unique: true })
  workspaceId!: string;

  @Prop({ type: String, required: true, enum: ['github'] })
  provider!: RepoProvider;

  @Prop({ required: true })
  owner!: string;

  @Prop({ required: true })
  repo!: string;

  @Prop({ required: true })
  defaultBranch!: string;

  // AES-256-GCM ciphertext of the PAT, plus its IV and auth tag -- see TokenCipherService.
  // Never exposed outside this schema; toConnectionDto() (repo-analysis.service.ts) omits all
  // three fields from any response.
  @Prop({ required: true })
  tokenCiphertext!: string;

  @Prop({ required: true })
  tokenIv!: string;

  @Prop({ required: true })
  tokenAuthTag!: string;

  @Prop({ required: true })
  tokenLast4!: string;

  @Prop({ required: true })
  connectedBy!: string;

  @Prop({ type: RepoAnalysisSchema, default: null })
  analysis!: RepoAnalysisEntry | null;
}

export const RepoConnectionSchema = SchemaFactory.createForClass(RepoConnection);
