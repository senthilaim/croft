import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Workspace as WorkspaceDto } from '@croft/shared-types';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema.js';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectModel(Workspace.name) private readonly workspaceModel: Model<WorkspaceDocument>,
  ) {}

  async create(name: string, ownerId: string): Promise<WorkspaceDocument> {
    return this.workspaceModel.create({ name, ownerId, memberIds: [ownerId] });
  }

  findAllForUser(userId: string): Promise<WorkspaceDocument[]> {
    return this.workspaceModel.find({ memberIds: userId }).sort({ createdAt: -1 }).exec();
  }

  findById(id: string): Promise<WorkspaceDocument | null> {
    return this.workspaceModel.findById(id).exec();
  }

  isMember(workspace: WorkspaceDocument, userId: string): boolean {
    return workspace.memberIds.includes(userId);
  }
}

export function toWorkspaceDto(workspace: WorkspaceDocument): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    ownerId: workspace.ownerId,
    memberIds: workspace.memberIds,
    createdAt: (workspace as WorkspaceDocument & { createdAt: Date }).createdAt.toISOString(),
  };
}
