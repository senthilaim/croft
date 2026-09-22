import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { BuildsService, toBuildSummaryDto } from '../builds/builds.service.js';
import { ProvisioningService } from '../provisioning/provisioning.service.js';
import { RepoConnectionService } from '../repo-analysis/repo-connection.service.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { LiveBus } from './live-bus.js';

const ACCESS_TOKEN_COOKIE = 'bf_access_token';
const BUILDS_COALESCE_MS = 250;
const INFRA_INTERVAL_MS = 3000;

interface SocketData {
  userId: string;
  workspaces: Set<string>;
}

const room = (workspaceId: string) => `workspace:${workspaceId}`;

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Pushes live build and infrastructure data to the dashboard over a WebSocket, replacing the
 * browser's 2s HTTP polling. Builds are pushed the moment a BEP event is ingested (coalesced, since
 * one build emits hundreds of events). Infra comes from `docker stats`, which has no push source, so
 * it is sampled once per workspace -- only while someone is watching -- and fanned out to all viewers.
 */
@WebSocketGateway({
  path: '/ws',
  addTrailingSlash: false,
  cors: { origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(LiveGateway.name);
  @WebSocketServer() private server!: Server;

  private readonly buildTimers = new Map<string, NodeJS.Timeout>();
  private readonly infraTimers = new Map<string, NodeJS.Timeout>();
  private readonly infraInFlight = new Set<string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly workspacesService: WorkspacesService,
    private readonly buildsService: BuildsService,
    private readonly provisioningService: ProvisioningService,
    private readonly repoConnectionService: RepoConnectionService,
    bus: LiveBus,
  ) {
    bus.onBuildsChanged((workspaceId) => this.scheduleBuilds(workspaceId));
    bus.onRepoAnalysisChanged((workspaceId) => void this.emitRepoAnalysis(workspaceId));
  }

  afterInit(): void {
    this.log.log('WebSocket live updates ready on /ws');
  }

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth as { token?: string } | undefined)?.token ??
      parseCookie(client.handshake.headers.cookie, ACCESS_TOKEN_COOKIE);
    try {
      if (!token) throw new Error('missing token');
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      (client.data as SocketData) = { userId: payload.sub, workspaces: new Set() };
    } catch {
      client.emit('unauthorized');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as SocketData | undefined;
    for (const workspaceId of data?.workspaces ?? []) this.stopInfraIfIdle(workspaceId);
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workspaceId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const data = client.data as SocketData | undefined;
    const workspaceId = body?.workspaceId;
    if (!data?.userId || !workspaceId) return { ok: false, error: 'unauthorized' };

    const workspace = await this.workspacesService.findById(workspaceId).catch(() => null);
    if (!workspace || !this.workspacesService.isMember(workspace, data.userId)) {
      return { ok: false, error: 'forbidden' };
    }

    await client.join(room(workspaceId));
    data.workspaces.add(workspaceId);

    // Snapshot immediately so a (re)connecting client is current without any HTTP round trip.
    await Promise.all([
      this.emitBuilds(workspaceId, client),
      this.emitInfra(workspaceId, client),
      this.emitRepoAnalysis(workspaceId, client),
    ]);
    this.startInfra(workspaceId);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workspaceId?: string },
  ): Promise<void> {
    const workspaceId = body?.workspaceId;
    if (!workspaceId) return;
    await client.leave(room(workspaceId));
    (client.data as SocketData | undefined)?.workspaces.delete(workspaceId);
    this.stopInfraIfIdle(workspaceId);
  }

  private hasViewers(workspaceId: string): boolean {
    return (this.server.sockets.adapter.rooms.get(room(workspaceId))?.size ?? 0) > 0;
  }

  private scheduleBuilds(workspaceId: string): void {
    if (this.buildTimers.has(workspaceId) || !this.hasViewers(workspaceId)) return;
    this.buildTimers.set(
      workspaceId,
      setTimeout(() => {
        this.buildTimers.delete(workspaceId);
        void this.emitBuilds(workspaceId);
      }, BUILDS_COALESCE_MS),
    );
  }

  private async emitBuilds(workspaceId: string, only?: Socket): Promise<void> {
    try {
      const builds = (await this.buildsService.findAllForWorkspace(workspaceId)).map((b) => toBuildSummaryDto(b));
      (only ?? this.server.to(room(workspaceId))).emit('builds', builds);
    } catch (err) {
      this.log.warn(`builds push failed for ${workspaceId}: ${String(err)}`);
    }
  }

  private async emitInfra(workspaceId: string, only?: Socket): Promise<void> {
    if (this.infraInFlight.has(workspaceId) && !only) return;
    this.infraInFlight.add(workspaceId);
    try {
      const infra = await this.provisioningService.infra(workspaceId);
      (only ?? this.server.to(room(workspaceId))).emit('infra', infra);
    } catch {
      // automation briefly unreachable: keep the last value on screen, try again next tick.
    } finally {
      this.infraInFlight.delete(workspaceId);
    }
  }

  private async emitRepoAnalysis(workspaceId: string, only?: Socket): Promise<void> {
    try {
      const analysis = await this.repoConnectionService.getAnalysis(workspaceId);
      if (!analysis) return; // no repo connected yet -- nothing to push
      (only ?? this.server.to(room(workspaceId))).emit('repoAnalysis', analysis);
    } catch (err) {
      this.log.warn(`repo analysis push failed for ${workspaceId}: ${String(err)}`);
    }
  }

  private startInfra(workspaceId: string): void {
    if (this.infraTimers.has(workspaceId)) return;
    this.infraTimers.set(
      workspaceId,
      setInterval(() => void this.emitInfra(workspaceId), INFRA_INTERVAL_MS),
    );
  }

  private stopInfraIfIdle(workspaceId: string): void {
    if (this.hasViewers(workspaceId)) return;
    const timer = this.infraTimers.get(workspaceId);
    if (timer) clearInterval(timer);
    this.infraTimers.delete(workspaceId);
  }
}
