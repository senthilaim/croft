import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { BuildfarmConfig } from '@bazel-bootstrap/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { BuildfarmConfigService, toBuildfarmConfigDto } from './buildfarm-config.service.js';
import { SaveBuildfarmConfigDto } from './dto/save-buildfarm-config.dto.js';

@Controller('workspaces/:id/buildfarm-config')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class BuildfarmConfigController {
  constructor(private readonly buildfarmConfigService: BuildfarmConfigService) {}

  @Get()
  async get(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmConfig> {
    const config = await this.buildfarmConfigService.getOrCreateDraft(workspace.id);
    return toBuildfarmConfigDto(config);
  }

  @Put()
  async save(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Body() dto: SaveBuildfarmConfigDto,
  ): Promise<BuildfarmConfig> {
    const config = await this.buildfarmConfigService.save(workspace.id, dto.nodes, dto.edges);
    return toBuildfarmConfigDto(config);
  }
}
