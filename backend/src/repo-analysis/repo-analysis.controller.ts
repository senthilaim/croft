import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { ConnectRepoRequest, RepoAnalysisResult, RepoConnection } from '@croft/shared-types';
import { CurrentUserId } from '../auth/current-user-id.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { RepoAnalysisService } from './repo-analysis.service.js';
import { RepoConnectionService } from './repo-connection.service.js';

@Controller('workspaces/:id/repo-analysis')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class RepoAnalysisController {
  constructor(
    private readonly repoConnectionService: RepoConnectionService,
    private readonly repoAnalysisService: RepoAnalysisService,
  ) {}

  @Post('connect')
  connect(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @CurrentUserId() userId: string,
    @Body() body: ConnectRepoRequest,
  ): Promise<RepoConnection> {
    return this.repoConnectionService.connect(workspace.id, userId, body?.repoUrl, body?.token);
  }

  @Get('connection')
  async getConnection(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<RepoConnection> {
    const connection = await this.repoConnectionService.getConnection(workspace.id);
    if (!connection) throw new NotFoundException('No repository connected for this workspace');
    return connection;
  }

  @Delete('connection')
  @HttpCode(200)
  async disconnect(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<{ ok: boolean }> {
    await this.repoConnectionService.disconnect(workspace.id);
    return { ok: true };
  }

  @Post('analyze')
  @HttpCode(202)
  startAnalysis(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<RepoAnalysisResult> {
    return this.repoAnalysisService.startAnalysis(workspace.id);
  }

  @Get('result')
  async getResult(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<RepoAnalysisResult> {
    const result = await this.repoAnalysisService.getResult(workspace.id);
    if (!result) throw new NotFoundException('No analysis has been run for this workspace');
    return result;
  }
}
