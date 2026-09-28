import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import type { CloudCredential, CloudCredentialSetupInfo, ConnectCloudCredentialRequest } from '@croft/shared-types';
import { CurrentUserId } from '../auth/current-user-id.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { CloudCredentialsService } from './cloud-credentials.service.js';

@Controller('workspaces/:id/cloud-credentials')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class CloudCredentialsController {
  constructor(private readonly cloudCredentialsService: CloudCredentialsService) {}

  @Get('setup-info')
  getSetupInfo(@CurrentWorkspace() workspace: WorkspaceDocument): CloudCredentialSetupInfo {
    return this.cloudCredentialsService.getSetupInfo(workspace.id);
  }

  @Post('connect')
  connect(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @CurrentUserId() userId: string,
    @Body() body: ConnectCloudCredentialRequest,
  ): Promise<CloudCredential> {
    return this.cloudCredentialsService.connect(workspace.id, userId, body);
  }

  @Get('connection')
  async getConnection(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<CloudCredential> {
    const connection = await this.cloudCredentialsService.getConnection(workspace.id);
    if (!connection) throw new NotFoundException('No cloud credential connected for this workspace');
    return connection;
  }

  @Delete('connection')
  @HttpCode(200)
  async disconnect(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<{ ok: boolean }> {
    await this.cloudCredentialsService.disconnect(workspace.id);
    return { ok: true };
  }
}
