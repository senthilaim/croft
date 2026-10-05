import { describe, expect, it } from 'vitest';
import { buildRolePolicyJson, buildTrustPolicyJson } from './aws-policy-templates.js';

const WORKSPACE_ID = '6ac321e304a82152998475ed';

interface PolicyStatement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
  Condition?: { StringEquals: Record<string, string | string[]> };
}

function statement(policy: { Statement: PolicyStatement[] }, sid: string): PolicyStatement {
  const found = policy.Statement.find((s) => s.Sid === sid);
  if (!found) throw new Error(`No statement with Sid "${sid}" in policy`);
  return found;
}

describe('buildTrustPolicyJson', () => {
  it('embeds the given external ID into the sts:ExternalId condition', () => {
    const policy = JSON.parse(buildTrustPolicyJson('ext-abc-123'));
    expect(policy.Statement[0].Condition.StringEquals['sts:ExternalId']).toBe('ext-abc-123');
    expect(policy.Statement[0].Action).toBe('sts:AssumeRole');
  });
});

describe('buildRolePolicyJson', () => {
  it('produces valid, parseable JSON with every expected statement present', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    const sids = policy.Statement.map((s: { Sid?: string }) => s.Sid);
    expect(sids).toEqual(
      expect.arrayContaining([
        'Ec2AndNetworking',
        'WorkerAutoScaling',
        'RedisElastiCache',
        'RemoteCacheBucket',
        'CacheInstanceRole',
        'PassCacheInstanceRoleToEc2Only',
        'ServiceLinkedRolesForAsgAndElastiCache',
        'ServerLoadBalancer',
      ]),
    );
  });

  it('scopes the S3 statement to exactly this workspace\'s own cache bucket', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    const s3 = statement(policy, 'RemoteCacheBucket');
    expect(s3.Resource).toEqual([
      `arn:aws:s3:::croft-${WORKSPACE_ID}-cache`,
      `arn:aws:s3:::croft-${WORKSPACE_ID}-cache/*`,
    ]);
  });

  it('scopes ElastiCache permissions to this workspace\'s own cluster/replication-group/subnet-group names', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    const elasticache = statement(policy, 'RedisElastiCache');
    expect(elasticache.Resource).toEqual([
      `arn:aws:elasticache:*:*:cluster:croft-${WORKSPACE_ID}-*`,
      `arn:aws:elasticache:*:*:replicationgroup:croft-${WORKSPACE_ID}-*`,
      `arn:aws:elasticache:*:*:subnetgroup:croft-${WORKSPACE_ID}*`,
    ]);
    // Phase 0: a replication group, not a single cache cluster -- the old single-node actions
    // are gone, replaced by their replication-group equivalents.
    expect(elasticache.Action).toContain('elasticache:CreateReplicationGroup');
    expect(elasticache.Action).toContain('elasticache:DeleteReplicationGroup');
    expect(elasticache.Action).not.toContain('elasticache:CreateCacheCluster');
  });

  it('scopes the cache instance IAM role/instance-profile to this workspace only, never a wildcard', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    const iamRole = statement(policy, 'CacheInstanceRole');
    expect(iamRole.Resource).toEqual([
      `arn:aws:iam::*:role/croft-${WORKSPACE_ID}-cache`,
      `arn:aws:iam::*:instance-profile/croft-${WORKSPACE_ID}-cache`,
    ]);
    expect((iamRole.Resource as string[]).every((r) => !r.endsWith('*') || r.includes(WORKSPACE_ID))).toBe(true);
  });

  it('conditions iam:PassRole to EC2 only, scoped to the one cache role -- never an unconditioned PassRole', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    const passRole = statement(policy, 'PassCacheInstanceRoleToEc2Only');
    expect(passRole.Action).toBe('iam:PassRole');
    expect(passRole.Resource).toBe(`arn:aws:iam::*:role/croft-${WORKSPACE_ID}-cache`);
    expect(passRole.Condition!.StringEquals['iam:PassedToService']).toBe('ec2.amazonaws.com');
  });

  it('conditions iam:CreateServiceLinkedRole to exactly autoscaling and elasticache, never unconditioned', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    const slr = statement(policy, 'ServiceLinkedRolesForAsgAndElastiCache');
    expect(slr.Action).toBe('iam:CreateServiceLinkedRole');
    expect(slr.Condition!.StringEquals['iam:AWSServiceName']).toEqual([
      'autoscaling.amazonaws.com',
      'elasticache.amazonaws.com',
    ]);
  });

  it('produces different scoped resource ARNs for different workspaces -- no cross-workspace reuse', () => {
    const policyA = JSON.parse(buildRolePolicyJson('workspace-a'));
    const policyB = JSON.parse(buildRolePolicyJson('workspace-b'));
    const bucketA = statement(policyA, 'RemoteCacheBucket').Resource[0];
    const bucketB = statement(policyB, 'RemoteCacheBucket').Resource[0];
    expect(bucketA).not.toBe(bucketB);
    expect(bucketA).toContain('workspace-a');
    expect(bucketB).toContain('workspace-b');
  });

  it('leaves EC2 and ASG permissions as Resource: "*" -- those services don\'t support resource-level ARNs for most of these actions', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    expect(statement(policy, 'Ec2AndNetworking').Resource).toBe('*');
    expect(statement(policy, 'WorkerAutoScaling').Resource).toBe('*');
  });

  it('grants the Phase 0 load-balancer permissions the NLB/target-group/listener need, unscoped like EC2 (ARNs embed an id unknown before creation)', () => {
    const policy = JSON.parse(buildRolePolicyJson(WORKSPACE_ID));
    const elb = statement(policy, 'ServerLoadBalancer');
    expect(elb.Resource).toBe('*');
    for (const action of [
      'elasticloadbalancing:CreateLoadBalancer',
      'elasticloadbalancing:CreateTargetGroup',
      'elasticloadbalancing:CreateListener',
      'elasticloadbalancing:RegisterTargets',
    ]) {
      expect(elb.Action).toContain(action);
    }
  });
});
