import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorkspaceDocument = HydratedDocument<Workspace>;

@Schema({ timestamps: true })
export class Workspace {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  ownerId!: string;

  @Prop({ type: [String], required: true, default: [] })
  memberIds!: string[];
}

export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);
