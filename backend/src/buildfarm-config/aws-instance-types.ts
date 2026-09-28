import { BadRequestException } from '@nestjs/common';
import { AWS_STAGING_INSTANCE_TYPES, type AwsStagingInstanceType, type BuildfarmProvider } from '@croft/shared-types';

/** Server-side enforcement of the shared allowlist (see AWS_STAGING_INSTANCE_TYPES's doc comment
 * in shared-types) -- not just defaulted/restricted in the designer UI, so a crafted request
 * can't ask for a bigger instance than the UI offers. */

/** Structural rather than the full BuildfarmNode type -- the Mongoose schema class's `config` is
 * a loose Record (see schemas/buildfarm-config.schema.ts), not shared-types' more specific
 * per-role union, and this function only ever needs to look at one optional field of it. */
interface NodeWithConfig {
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
