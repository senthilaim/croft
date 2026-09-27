import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  UpdateMemberRoleRequest,
  Workspace as WorkspaceDto,
  WorkspaceMember,
  WorkspaceRole,
} from '@croft/shared-types';
import { UsersService } from '../users/users.service.js';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema.js';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectModel(Workspace.name) private readonly workspaceModel: Model<WorkspaceDocument>,
    private readonly usersService: UsersService,
  ) {}

  async create(name: string, ownerId: string): Promise<WorkspaceDocument> {
    return this.workspaceModel.create({ name, ownerId, memberIds: [ownerId], members: [] });
  }

  findAllForUser(userId: string): Promise<WorkspaceDocument[]> {
    return this.workspaceModel.find({ memberIds: userId }).sort({ createdAt: -1 }).exec();
  }

  findById(id: string): Promise<WorkspaceDocument | null> {
    return this.workspaceModel.findById(id).exec();
  }

  isMember(workspace: WorkspaceDocument, userId: string): boolean {
    return this.getRole(workspace, userId) !== null;
  }

  /** The single source of truth for "what can this user do in this workspace" -- owner is always
   * implicit (never stored), then a real `members` entry, then a fallback to the legacy
   * `memberIds` list (as 'member') for any workspace document that predates the `members` field --
   * see the schema's own comment for why that fallback exists instead of a migration. */
  getRole(workspace: WorkspaceDocument, userId: string): WorkspaceRole | null {
    if (workspace.ownerId === userId) return 'owner';
    const entry = workspace.members.find((m) => m.userId === userId);
    if (entry) return entry.role;
    if (workspace.memberIds.includes(userId)) return 'member';
    return null;
  }

  private async syncMemberIds(workspace: WorkspaceDocument): Promise<void> {
    workspace.memberIds = [workspace.ownerId, ...workspace.members.map((m) => m.userId)];
    await workspace.save();
  }

  async listMembers(workspace: WorkspaceDocument): Promise<WorkspaceMember[]> {
    const userIds = [workspace.ownerId, ...workspace.members.map((m) => m.userId)];
    const users = await this.usersService.findPublicByIds(userIds);
    const usersById = new Map(users.map((u) => [u.id, u]));

    const result: WorkspaceMember[] = [];
    for (const userId of userIds) {
      const user = usersById.get(userId);
      if (!user) continue; // a deleted account -- skip rather than show a broken row
      const role = this.getRole(workspace, userId);
      if (!role) continue;
      result.push({ userId, email: user.email, name: user.name, role });
    }
    return result;
  }

  async inviteMember(
    workspace: WorkspaceDocument,
    email: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<WorkspaceDocument> {
    const user = await this.usersService.findPublicByEmail(email);
    if (!user) {
      throw new NotFoundException('No Croft account with that email -- ask them to sign up first, then try again.');
    }
    if (this.getRole(workspace, user.id)) {
      throw new BadRequestException('This person is already a member of this workspace.');
    }
    workspace.members.push({ userId: user.id, role });
    await this.syncMemberIds(workspace);
    return workspace;
  }

  async updateMemberRole(
    workspace: WorkspaceDocument,
    userId: string,
    role: UpdateMemberRoleRequest['role'],
  ): Promise<WorkspaceDocument> {
    if (userId === workspace.ownerId) {
      throw new ForbiddenException("The owner's role can't be changed.");
    }
    const entry = workspace.members.find((m) => m.userId === userId);
    if (!entry) throw new NotFoundException('Not a member of this workspace');
    entry.role = role;
    await workspace.save();
    return workspace;
  }

  async removeMember(workspace: WorkspaceDocument, userId: string): Promise<WorkspaceDocument> {
    if (userId === workspace.ownerId) {
      throw new ForbiddenException('The owner cannot be removed from their own workspace.');
    }
    workspace.members = workspace.members.filter((m) => m.userId !== userId);
    await this.syncMemberIds(workspace);
    return workspace;
  }
}

export function toWorkspaceDto(workspace: WorkspaceDocument, role: WorkspaceRole): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    ownerId: workspace.ownerId,
    memberIds: workspace.memberIds,
    myRole: role,
    createdAt: (workspace as WorkspaceDocument & { createdAt: Date }).createdAt.toISOString(),
  };
}
