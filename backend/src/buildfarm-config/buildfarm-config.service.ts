import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  BuildfarmConfig as BuildfarmConfigDto,
  BuildfarmConfigStatus,
  BuildfarmProvider,
} from '@croft/shared-types';
import {
  BuildfarmConfig,
  BuildfarmConfigDocument,
  BuildfarmEdge,
  BuildfarmNode,
} from './schemas/buildfarm-config.schema.js';

@Injectable()
export class BuildfarmConfigService {
  constructor(
    @InjectModel(BuildfarmConfig.name)
    private readonly buildfarmConfigModel: Model<BuildfarmConfigDocument>,
  ) {}

  async getOrCreateDraft(workspaceId: string): Promise<BuildfarmConfigDocument> {
    const existing = await this.buildfarmConfigModel.findOne({ workspaceId }).exec();
    if (existing) return existing;
    return this.buildfarmConfigModel.create({
      workspaceId,
      provider: 'docker',
      nodes: [],
      edges: [],
      status: 'draft',
    });
  }

  async save(
    workspaceId: string,
    provider: BuildfarmProvider,
    nodes: BuildfarmNode[],
    edges: BuildfarmEdge[],
  ): Promise<BuildfarmConfigDocument> {
    const updated = await this.buildfarmConfigModel
      .findOneAndUpdate(
        { workspaceId },
        { workspaceId, provider, nodes, edges, status: 'draft' },
        { new: true, upsert: true },
      )
      .exec();
    return updated;
  }

  async setStatus(workspaceId: string, status: BuildfarmConfigStatus): Promise<void> {
    await this.buildfarmConfigModel.updateOne({ workspaceId }, { status }).exec();
  }
}

export function toBuildfarmConfigDto(doc: BuildfarmConfigDocument): BuildfarmConfigDto {
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    provider: doc.provider,
    nodes: doc.nodes as unknown as BuildfarmConfigDto['nodes'],
    edges: doc.edges,
    status: doc.status,
    updatedAt: (doc as BuildfarmConfigDocument & { updatedAt: Date }).updatedAt.toISOString(),
  };
}
