import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { BuildfarmNode, CostReport } from '@croft/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { BuildfarmConfigService } from '../buildfarm-config/buildfarm-config.service.js';
import { BuildsService } from '../builds/builds.service.js';
import { estimateCosts } from './cost-estimator.js';

function num(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(`${name} must be a number between ${min} and ${max}`);
  }
  return parsed;
}

@Controller('workspaces/:id/cost')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class CostController {
  constructor(
    private readonly configService: BuildfarmConfigService,
    private readonly buildsService: BuildsService,
  ) {}

  /** Estimated monthly cost of this workspace's designed topology on each hosting option. Works
   * before anything is provisioned, since it reads the saved design, not running containers. */
  @Get()
  async estimate(
    @CurrentWorkspace() workspace: WorkspaceDocument,
    @Query('hoursPerDay') hoursPerDay?: string,
    @Query('buildsPerMonth') buildsPerMonth?: string,
    @Query('onPremVcpuHour') onPremVcpuHour?: string,
  ): Promise<CostReport> {
    const config = await this.configService.getOrCreateDraft(workspace.id);
    const nodes = config.nodes as unknown as BuildfarmNode[];

    const override = num(buildsPerMonth, 'buildsPerMonth', 0, 10_000_000);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    const measured = await this.buildsService.countSince(workspace.id, since.toISOString());

    return estimateCosts({
      nodes,
      hoursPerDay: num(hoursPerDay, 'hoursPerDay', 1, 24) ?? 24,
      buildsPerMonth: override ?? measured,
      buildsMeasured: override === undefined,
      onPremVcpuHour: num(onPremVcpuHour, 'onPremVcpuHour', 0, 10),
    });
  }
}
