import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { Workspace } from '@croft/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUserId } from '../auth/current-user-id.decorator.js';
import { CreateWorkspaceDto } from './dto/create-workspace.dto.js';
import { WorkspacesService, toWorkspaceDto } from './workspaces.service.js';
import { WorkspaceMembershipGuard } from './workspace-membership.guard.js';
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
}
