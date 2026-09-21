import { BadRequestException, Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import type { FileContent, FileGroup } from '@croft/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { FilesService } from './files.service.js';

@Controller('workspaces/:id/files')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  list(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<FileGroup[]> {
    return this.filesService.list(workspace.id);
  }

  @Get('content')
  async content(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Query('group') group?: string,
    @Query('path') path?: string,
  ): Promise<FileContent> {
    if (!group || !path) throw new BadRequestException('group and path are required');
    const file = await this.filesService.read(workspace.id, group, path);
    if (!file) throw new NotFoundException('File not found');
    return file;
  }
}
