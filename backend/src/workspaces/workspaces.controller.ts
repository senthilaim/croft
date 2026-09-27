import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { Workspace, WorkspaceMember } from '@croft/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUserId } from '../auth/current-user-id.decorator.js';
import { CreateWorkspaceDto } from './dto/create-workspace.dto.js';
import { InviteMemberDto } from './dto/invite-member.dto.js';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto.js';
import { WorkspacesService, toWorkspaceDto } from './workspaces.service.js';
import { WorkspaceMembershipGuard } from './workspace-membership.guard.js';
import { WorkspaceRoleGuard } from './workspace-role.guard.js';
import { CurrentWorkspace } from './current-workspace.decorator.js';
import { CurrentWorkspaceRole } from './current-workspace-role.decorator.js';
import type { WorkspaceDocument } from './schemas/workspace.schema.js';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  async create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateWorkspaceDto,
  ): Promise<Workspace> {
    const workspace = await this.workspacesService.create(dto.name, userId);
    return toWorkspaceDto(workspace, 'owner');
  }

  @Get()
  async findAll(@CurrentUserId() userId: string): Promise<Workspace[]> {
    const workspaces = await this.workspacesService.findAllForUser(userId);
    return workspaces.map((w) => toWorkspaceDto(w, this.workspacesService.getRole(w, userId)!));
  }

  @Get(':id')
  @UseGuards(WorkspaceMembershipGuard)
  findOne(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @CurrentWorkspaceRole() role: Workspace['myRole'],
  ): Workspace {
    return toWorkspaceDto(workspace, role);
  }

  @Get(':id/members')
  @UseGuards(WorkspaceMembershipGuard)
  listMembers(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<WorkspaceMember[]> {
    return this.workspacesService.listMembers(workspace);
  }

  @Post(':id/members')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRoleGuard('owner', 'admin'))
  async inviteMember(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Body() dto: InviteMemberDto,
  ): Promise<WorkspaceMember[]> {
    const updated = await this.workspacesService.inviteMember(workspace, dto.email, dto.role);
    return this.workspacesService.listMembers(updated);
  }

  @Patch(':id/members/:userId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRoleGuard('owner'))
  async updateMemberRole(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<WorkspaceMember[]> {
    const updated = await this.workspacesService.updateMemberRole(workspace, userId, dto.role);
    return this.workspacesService.listMembers(updated);
  }

  // Deliberately not role-guarded like the routes above: removing *someone else* requires
  // owner/admin, but any member may always remove themselves (leave the workspace) regardless of
  // role -- a mixed rule that doesn't fit the single-allowed-roles-list shape WorkspaceRoleGuard
  // expresses, so it's checked inline instead.
  @Delete(':id/members/:userId')
  @UseGuards(WorkspaceMembershipGuard)
  async removeMember(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @CurrentWorkspaceRole() role: Workspace['myRole'],
    @CurrentUserId() currentUserId: string,
    @Param('userId') userId: string,
  ): Promise<WorkspaceMember[]> {
    const isSelf = userId === currentUserId;
    if (!isSelf && role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('Only an owner or admin can remove another member.');
    }
    const updated = await this.workspacesService.removeMember(workspace, userId);
    return this.workspacesService.listMembers(updated);
  }
}
