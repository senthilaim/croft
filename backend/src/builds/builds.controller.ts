import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import type { Build } from '@bazel-bootstrap/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import type { BuildEventJson } from './bep-parser.js';
import { BuildsService, toBuildDto } from './builds.service.js';

/**
 * Ingests live Build Event Protocol events relayed from the automation service's BES
 * (Build Event Service) gRPC server -- see automation/app/bes_server.py. Intentionally
 * unauthenticated: it's only reachable from that same-machine service, scoped by workspace id
 * in the URL. Fine for a local-first MVP; would need a per-workspace ingest token before this
 * app is ever exposed beyond localhost.
 */
@Controller('workspaces/:id/builds')
export class BuildsIngestController {
  constructor(private readonly buildsService: BuildsService) {}

  @Post('ingest-event')
  async ingestEvent(
    @Param('id') workspaceId: string,
    @Body() body: BuildEventJson,
  ): Promise<{ ok: boolean }> {
    await this.buildsService.ingestEvent(workspaceId, body ?? {});
    return { ok: true };
  }
}

@Controller('workspaces/:id/builds')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class BuildsController {
  constructor(private readonly buildsService: BuildsService) {}

  @Get()
  async findAll(@Param('id') workspaceId: string): Promise<Build[]> {
    const builds = await this.buildsService.findAllForWorkspace(workspaceId);
    return builds.map(toBuildDto);
  }

  @Get(':buildId')
  async findOne(
    @Param('id') workspaceId: string,
    @Param('buildId') buildId: string,
  ): Promise<Build> {
    const build = await this.buildsService.findOne(workspaceId, buildId);
    if (!build) throw new NotFoundException('Build not found');
    return toBuildDto(build);
  }
}
