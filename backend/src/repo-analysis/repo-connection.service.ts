import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  RebuildSimulationResult,
  RepoAnalysisResult,
  RepoConnection as RepoConnectionDto,
} from '@croft/shared-types';
import { TokenCipherService } from '../crypto/token-cipher.service.js';
import { RepoConnection, RepoConnectionDocument } from './schemas/repo-connection.schema.js';

const GITHUB_URL_RE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
}

export function parseGitHubUrl(repoUrl: string): ParsedGitHubUrl | null {
  const match = repoUrl.trim().match(GITHUB_URL_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

interface GitHubRepoInfo {
  defaultBranch: string;
}

/** Calls GitHub's API once with the caller's token to confirm it's valid/read-scoped for this repo
 * and to resolve the default branch -- deliberately done before any encryption/storage, so a
 * bad or expired token is rejected immediately rather than stored to fail later. */
export async function fetchGitHubRepoInfo(
  owner: string,
  repo: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubRepoInfo> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'croft-repo-analysis',
      },
    });
  } catch {
    throw new BadRequestException('Could not reach GitHub. Check your network connection and try again.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new BadRequestException('GitHub rejected this token. Confirm it is valid and has repo read access.');
  }
  if (res.status === 404) {
    throw new BadRequestException('Repository not found, or this token cannot read it.');
  }
  if (!res.ok) {
    throw new BadRequestException(`GitHub returned an unexpected error (${res.status}).`);
  }
  const body = (await res.json()) as { default_branch?: string };
  if (!body.default_branch) {
    throw new BadRequestException('Could not determine the default branch for this repository.');
  }
  return { defaultBranch: body.default_branch };
}

function toDto(doc: RepoConnectionDocument): RepoConnectionDto {
  return {
    workspaceId: doc.workspaceId,
    provider: doc.provider,
    owner: doc.owner,
    repo: doc.repo,
    defaultBranch: doc.defaultBranch,
    tokenLast4: doc.tokenLast4,
    connectedBy: doc.connectedBy,
    connectedAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

@Injectable()
export class RepoConnectionService {
  constructor(
    @InjectModel(RepoConnection.name) private readonly model: Model<RepoConnectionDocument>,
    private readonly tokenCipher: TokenCipherService,
  ) {}

  async connect(
    workspaceId: string,
    userId: string,
    repoUrl: string,
    token: string,
  ): Promise<RepoConnectionDto> {
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      throw new BadRequestException('Enter a GitHub repository URL, e.g. https://github.com/owner/repo');
    }
    if (!token || token.trim().length < 8) {
      throw new BadRequestException('Enter a GitHub personal access token');
    }
    const trimmedToken = token.trim();
    const { defaultBranch } = await fetchGitHubRepoInfo(parsed.owner, parsed.repo, trimmedToken);
    const encrypted = this.tokenCipher.encrypt(trimmedToken);

    const doc = await this.model.findOneAndUpdate(
      { workspaceId },
      {
        workspaceId,
        provider: 'github',
        owner: parsed.owner,
        repo: parsed.repo,
        defaultBranch,
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenAuthTag: encrypted.authTag,
        tokenLast4: trimmedToken.slice(-4),
        connectedBy: userId,
        analysis: null,
        latestSimulation: null,
      },
      { upsert: true, new: true },
    );
    return toDto(doc);
  }

  async getConnection(workspaceId: string): Promise<RepoConnectionDto | null> {
    const doc = await this.model.findOne({ workspaceId }).exec();
    return doc ? toDto(doc) : null;
  }

  async disconnect(workspaceId: string): Promise<void> {
    await this.model.deleteOne({ workspaceId }).exec();
  }

  async getAnalysis(workspaceId: string): Promise<RepoAnalysisResult | null> {
    const doc = await this.model.findOne({ workspaceId }, { analysis: 1 }).exec();
    return (doc?.analysis as unknown as RepoAnalysisResult | null) ?? null;
  }

  /** Whole-document replace of the analysis field -- there is no history, a re-run always
   * overwrites the previous result (see the schema's doc comment for why). */
  async saveAnalysis(workspaceId: string, analysis: RepoAnalysisResult): Promise<void> {
    await this.model.updateOne({ workspaceId }, { $set: { analysis } }).exec();
  }

  /** Updates only the live log tail while a run is in progress, without touching the rest of the
   * (still-empty) analysis fields -- cheaper than a full saveAnalysis on every poll tick. Only
   * takes effect while an analysis document already exists (i.e. after startAnalysis's initial
   * save), which is always true by the time polling starts. */
  async updateAnalysisLog(workspaceId: string, logTail: string): Promise<void> {
    await this.model
      .updateOne({ workspaceId, 'analysis.status': 'running' }, { $set: { 'analysis.logTail': logTail } })
      .exec();
  }

  async getSimulation(workspaceId: string): Promise<RebuildSimulationResult | null> {
    const doc = await this.model.findOne({ workspaceId }, { latestSimulation: 1 }).exec();
    return (doc?.latestSimulation as unknown as RebuildSimulationResult | null) ?? null;
  }

  /** Whole-document replace, same "latest only, no history" convention as saveAnalysis. */
  async saveSimulation(workspaceId: string, simulation: RebuildSimulationResult): Promise<void> {
    await this.model.updateOne({ workspaceId }, { $set: { latestSimulation: simulation } }).exec();
  }

  async updateSimulationLog(workspaceId: string, logTail: string): Promise<void> {
    await this.model
      .updateOne(
        { workspaceId, 'latestSimulation.status': 'running' },
        { $set: { 'latestSimulation.logTail': logTail } },
      )
      .exec();
  }

  /** For internal use only (the analyze flow) -- never exposed through a controller response. */
  async getDecryptedToken(workspaceId: string): Promise<{ doc: RepoConnectionDocument; token: string } | null> {
    const doc = await this.model.findOne({ workspaceId }).exec();
    if (!doc) return null;
    try {
      const token = this.tokenCipher.decrypt({
        ciphertext: doc.tokenCiphertext,
        iv: doc.tokenIv,
        authTag: doc.tokenAuthTag,
      });
      return { doc, token };
    } catch {
      throw new BadRequestException(
        "This repository's stored token can no longer be read. Reconnect it with a new token.",
      );
    }
  }
}
