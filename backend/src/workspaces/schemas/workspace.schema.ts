import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { WorkspacePlan, WorkspaceRole } from '@croft/shared-types';

export type WorkspaceDocument = HydratedDocument<Workspace>;

// _id: false -- these are pure value entries, never referenced by their own id independent of the
// parent workspace document.
@Schema({ _id: false })
export class WorkspaceMemberEntry {
  @Prop({ required: true })
  userId!: string;

  @Prop({ type: String, required: true, enum: ['admin', 'member', 'viewer'] })
  role!: Exclude<WorkspaceRole, 'owner'>;
}
const WorkspaceMemberEntrySchema = SchemaFactory.createForClass(WorkspaceMemberEntry);

@Schema({ timestamps: true })
export class Workspace {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  ownerId!: string;

  // Derived/denormalized -- see workspaces.service.ts's getRole()/member-management methods,
  // which are the real source of truth (the `members` array below) and keep this in sync on every
  // change. Kept only so existing `.length` displays and the `findAllForUser` query don't need to
  // change.
  @Prop({ type: [String], required: true, default: [] })
  memberIds!: string[];

  // The owner is never duplicated in here -- their role is always implicit (userId === ownerId).
  // Absent/empty on any workspace created before this field existed; getRole() falls back to
  // treating anyone in the legacy memberIds as a 'member' in that case, so no migration is needed.
  @Prop({ type: [WorkspaceMemberEntrySchema], default: [] })
  members!: WorkspaceMemberEntry[];

  // Absent on any workspace created before billing existed -- treated as 'free' by the DTO mapper
  // (toWorkspaceDto), not by a Mongoose-level default, so a document read straight from Mongo
  // before that mapping runs doesn't silently claim a plan it was never actually given.
  @Prop({ type: String, enum: ['free', 'team'] })
  plan?: WorkspacePlan;

  @Prop({ type: String, default: null })
  stripeCustomerId!: string | null;

  @Prop({ type: String, default: null })
  stripeSubscriptionId!: string | null;

  @Prop({ type: String, default: null })
  stripeSubscriptionStatus!: string | null;
}

export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);
