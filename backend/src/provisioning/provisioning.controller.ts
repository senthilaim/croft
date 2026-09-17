import { BadRequestException, Controller, NotFoundException, Post, Get, UseGuards } from '@nestjs/common';
import type { BuildfarmInstance, BuildfarmNode, InfraStats } from '@bazel-bootstrap/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { BuildfarmConfigService } from '../buildfarm-config/buildfarm-config.service.js';
import { validateTopology } from '../buildfarm-config/buildfarm-topology.js';
import { ProvisioningService } from './provisioning.service.js';

@Controller('workspaces/:id/buildfarm')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class ProvisioningController {
  constructor(
    private readonly provisioningService: ProvisioningService,
    private readonly buildfarmConfigService: BuildfarmConfigService,
  ) {}

  @Post('submit')
  async submit(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmInstance> {
    const config = await this.buildfarmConfigService.getOrCreateDraft(workspace.id);
    const issues = validateTopology(config.nodes as unknown as BuildfarmNode[], config.edges);
    if (issues.length > 0) {
      throw new BadRequestException({ message: 'Invalid buildfarm topology', issues });
    }

    await this.buildfarmConfigService.setStatus(workspace.id, 'provisioning');
    try {
      const instance = await this.provisioningService.submit(
        workspace.id,
        config.nodes as unknown as BuildfarmNode[],
        config.edges,
      );
      await this.buildfarmConfigService.setStatus(workspace.id, instance.status);
      return instance;
    } catch (err) {
      await this.buildfarmConfigService.setStatus(workspace.id, 'error');
      throw err;
    }
  }

  @Post('teardown')
  async teardown(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmInstance> {
    const instance = await this.provisioningService.teardown(workspace.id);
    await this.buildfarmConfigService.setStatus(workspace.id, 'stopped');
    return instance;
  }

  @Get('status')
  async status(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<BuildfarmInstance> {
    const instance = await this.provisioningService.status(workspace.id);
    if (!instance) throw new NotFoundException('No buildfarm instance for this workspace');
    return instance;
  }

  @Get('infra')
  infra(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<InfraStats> {
    return this.provisioningService.infra(workspace.id);
  }
}
