import { BadRequestException } from '@nestjs/common';
import { AWS_STAGING_INSTANCE_TYPES, type AwsStagingInstanceType, type BuildfarmProvider } from '@croft/shared-types';

/** Server-side enforcement of the shared allowlist (see AWS_STAGING_INSTANCE_TYPES's doc comment
 * in shared-types) -- not just defaulted/restricted in the designer UI, so a crafted request
 * can't ask for a bigger instance than the UI offers. */

/** Structural rather than the full BuildfarmNode type -- the Mongoose schema class's `config` is
 * a loose Record (see schemas/buildfarm-config.schema.ts), not shared-types' more specific
 * per-role union, and these functions only ever need to look at one or two optional fields of it. */
interface NodeWithConfig {
  type?: unknown;
  config: unknown;
}

/** A plain function (not a method) so it can be unit-tested without instantiating
 * BuildfarmConfigService or its Mongoose schema -- mirrors parseGitHubUrl/fetchGitHubRepoInfo's
 * extraction in repo-connection.service.ts. No-op for Docker designs. */
export function assertAwsInstanceTypesAllowed(provider: BuildfarmProvider, nodes: NodeWithConfig[]): void {
  if (provider !== 'aws') return;
  for (const node of nodes) {
    const instanceType = (node.config as { instanceType?: unknown }).instanceType;
    if (instanceType === undefined) continue;
    if (!AWS_STAGING_INSTANCE_TYPES.includes(instanceType as AwsStagingInstanceType)) {
      throw new BadRequestException(
        `Unsupported AWS instance type "${String(instanceType)}" -- this release only supports: ${AWS_STAGING_INSTANCE_TYPES.join(', ')}`,
      );
    }
  }
}

const AWS_ONLY_REMOTE_CACHE_TIERS = new Set(['s3', 'both']);

/** The Cache node's L2 remote-cache tier: "local" works on both providers (a plain bazel-remote
 * container/instance with no S3), but "s3"/"both" need a real AWS S3 bucket -- same AWS-gating
 * precedent as assertAwsInstanceTypesAllowed above, kept as a sibling function rather than folded
 * into it since it checks a different field on a different node type. */
export function assertRemoteCacheTierAllowed(provider: BuildfarmProvider, nodes: NodeWithConfig[]): void {
  if (provider === 'aws') return;
  for (const node of nodes) {
    if (node.type !== 'cache') continue;
    const tier = (node.config as { remoteCacheTier?: unknown }).remoteCacheTier;
    if (tier !== undefined && AWS_ONLY_REMOTE_CACHE_TIERS.has(tier as string)) {
      throw new BadRequestException(
        `The "${String(tier)}" remote cache tier needs AWS -- connect an AWS account under Settings > Cloud, or use the "local" tier instead`,
      );
    }
  }
}
