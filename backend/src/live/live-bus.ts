import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** In-process signal that a workspace's build data changed. Keeps BuildsService independent of the
 * websocket layer (which itself depends on BuildsService). */
@Injectable()
export class LiveBus {
  private readonly emitter = new EventEmitter();

  buildsChanged(workspaceId: string): void {
    this.emitter.emit('builds', workspaceId);
  }

  onBuildsChanged(listener: (workspaceId: string) => void): void {
    this.emitter.on('builds', listener);
  }

  repoAnalysisChanged(workspaceId: string): void {
    this.emitter.emit('repoAnalysis', workspaceId);
  }

  onRepoAnalysisChanged(listener: (workspaceId: string) => void): void {
    this.emitter.on('repoAnalysis', listener);
  }

  rebuildSimulationChanged(workspaceId: string): void {
    this.emitter.emit('rebuildSimulation', workspaceId);
  }

  onRebuildSimulationChanged(listener: (workspaceId: string) => void): void {
    this.emitter.on('rebuildSimulation', listener);
  }
}

@Global()
@Module({ providers: [LiveBus], exports: [LiveBus] })
export class LiveBusModule {}
