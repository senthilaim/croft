import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { DemoService } from './demo.service.js';

@Controller('workspaces/:id/demo')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Get()
  async status(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<{ builds: number }> {
    return { builds: await this.demoService.count(workspace.id) };
  }

  @Post()
  @HttpCode(200)
  seed(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<{ builds: number; testRuns: number }> {
    return this.demoService.seed(workspace.id);
  }

  @Delete()
  @HttpCode(200)
  async clear(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<{ ok: boolean }> {
    await this.demoService.clear(workspace.id);
    return { ok: true };
  }
}
