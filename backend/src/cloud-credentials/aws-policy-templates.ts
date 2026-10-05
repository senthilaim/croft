/**
 * Copy-pasteable IAM JSON shown in the credentials-setup UI, with the workspace's own External ID
 * and resource-name prefix already substituted in. The trust policy's Principal is left as a
 * placeholder -- Croft has no way to know the customer's bootstrap IAM user ARN before they create
 * it, since that user is what they'll submit the access key for on the connect form.
 *
 * The role policy is split into several Statement entries by AWS service rather than one flat
 * list, each following the same philosophy established for EC2: read-only wildcards (Describe,
 * Get, List -- non-mutating, free) granted broadly to avoid a whack-a-mole of one-more-missing-permission
 * failures the Terraform AWS provider's own attribute-readback calls can trigger (a real gap hit
 * in practice three times during development, not a hypothetical concern) -- every mutating action
 * enumerated exactly. Where a service supports resource-level ARNs (S3, ElastiCache, the one IAM
 * role/instance-profile this module creates), permissions are scoped to this workspace's own
 * resource-name prefix, not left as `Resource: '*'` the way most of EC2 has to be (EC2 doesn't
 * support resource-level ARNs for the majority of these actions).
 */

const EC2_ACTIONS = [
  // See the file-level comment -- Describe* covers auxiliary read-back calls (e.g. aws_vpc's DNS
  // settings are verified via DescribeVpcAttribute after ModifyVpcAttribute) that aren't fully
  // enumerable in advance.
  'ec2:Describe*',
  'ec2:RunInstances',
  'ec2:TerminateInstances',
  'ec2:StartInstances',
  'ec2:StopInstances',
  'ec2:CreateTags',
  'ec2:DeleteTags',
  'ec2:CreateSecurityGroup',
  'ec2:DeleteSecurityGroup',
  'ec2:AuthorizeSecurityGroupIngress',
  'ec2:RevokeSecurityGroupIngress',
  'ec2:AuthorizeSecurityGroupEgress',
  'ec2:RevokeSecurityGroupEgress',
  'ec2:CreateVpc',
  'ec2:DeleteVpc',
  'ec2:ModifyVpcAttribute',
  'ec2:CreateSubnet',
  'ec2:DeleteSubnet',
  // The subnet's map_public_ip_on_launch is applied as a post-create attribute modification, the
  // same pattern as the VPC's DNS settings above -- a real gap hit in practice (ModifyVpcAttribute
  // alone wasn't enough).
  'ec2:ModifySubnetAttribute',
  'ec2:CreateInternetGateway',
  'ec2:DeleteInternetGateway',
  'ec2:AttachInternetGateway',
  'ec2:DetachInternetGateway',
  'ec2:CreateRouteTable',
  'ec2:DeleteRouteTable',
  'ec2:CreateRoute',
  'ec2:DeleteRoute',
  'ec2:AssociateRouteTable',
  'ec2:DisassociateRouteTable',
  // NAT Gateway + its Elastic IP, for the Worker/Redis/cache private subnet's outbound internet.
  'ec2:CreateNatGateway',
  'ec2:DeleteNatGateway',
  'ec2:AllocateAddress',
  'ec2:ReleaseAddress',
  'ec2:AssociateAddress',
  'ec2:DisassociateAddress',
] as const;

const AUTOSCALING_ACTIONS = [
  'autoscaling:Describe*',
  'autoscaling:CreateAutoScalingGroup',
  'autoscaling:DeleteAutoScalingGroup',
  'autoscaling:UpdateAutoScalingGroup',
  'autoscaling:CreateLaunchConfiguration',
  'autoscaling:DeleteLaunchConfiguration',
  'autoscaling:CreateOrUpdateTags',
  'autoscaling:DeleteTags',
  'autoscaling:PutScalingPolicy',
  'autoscaling:DeletePolicy',
] as const;

// Launch templates are EC2 resources (not autoscaling:*), used by the ASG's launch_template block.
const EC2_LAUNCH_TEMPLATE_ACTIONS = [
  'ec2:CreateLaunchTemplate',
  'ec2:DeleteLaunchTemplate',
  'ec2:CreateLaunchTemplateVersion',
  'ec2:ModifyLaunchTemplate',
] as const;

export function buildTrustPolicyJson(externalId: string): string {
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: 'arn:aws:iam::<YOUR_ACCOUNT_ID>:user/<YOUR_BOOTSTRAP_USER_NAME>' },
          Action: 'sts:AssumeRole',
          Condition: { StringEquals: { 'sts:ExternalId': externalId } },
        },
      ],
    },
    null,
    2,
  );
}

/** `workspaceId` scopes the S3/ElastiCache/IAM statements to exactly this workspace's own
 * resource-name prefix (`croft-${workspaceId}-*`, matching the Terraform module's `local.name`) --
 * the permission policy is workspace-specific, unlike the trust policy's reusable-looking shape. */
export function buildRolePolicyJson(workspaceId: string): string {
  const namePrefix = `croft-${workspaceId}`;

  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'Ec2AndNetworking',
          Effect: 'Allow',
          Action: [...EC2_ACTIONS, ...EC2_LAUNCH_TEMPLATE_ACTIONS],
          Resource: '*',
        },
        {
          Sid: 'WorkerAutoScaling',
          Effect: 'Allow',
          Action: [...AUTOSCALING_ACTIONS],
          Resource: '*',
        },
        {
          Sid: 'RedisElastiCache',
          Effect: 'Allow',
          Action: [
            'elasticache:Describe*',
            'elasticache:AddTagsToResource',
            'elasticache:CreateCacheCluster',
            'elasticache:DeleteCacheCluster',
            'elasticache:CreateCacheSubnetGroup',
            'elasticache:DeleteCacheSubnetGroup',
          ],
          Resource: [
            `arn:aws:elasticache:*:*:cluster:${namePrefix}-*`,
            `arn:aws:elasticache:*:*:subnetgroup:${namePrefix}*`,
          ],
        },
        {
          Sid: 'RemoteCacheBucket',
          Effect: 'Allow',
          Action: [
            's3:Get*',
            's3:List*',
            's3:CreateBucket',
            's3:DeleteBucket',
            's3:PutBucketTagging',
            's3:PutEncryptionConfiguration',
            's3:PutLifecycleConfiguration',
            's3:PutObject',
            's3:DeleteObject',
          ],
          Resource: [`arn:aws:s3:::${namePrefix}-cache`, `arn:aws:s3:::${namePrefix}-cache/*`],
        },
        {
          // The one IAM-managing statement this policy needs: the dedicated cache instance's own
          // role (bazel-remote's S3 access), scoped to exactly the one role/instance-profile name
          // this module ever creates -- never a wildcard IAM resource, and PassRole is additionally
          // conditioned to EC2 only, so this can't be used to grant the role to anything else.
          Sid: 'CacheInstanceRole',
          Effect: 'Allow',
          Action: [
            'iam:Get*',
            'iam:List*',
            'iam:CreateRole',
            'iam:DeleteRole',
            'iam:TagRole',
            'iam:UntagRole',
            'iam:PutRolePolicy',
            'iam:DeleteRolePolicy',
            'iam:CreateInstanceProfile',
            'iam:DeleteInstanceProfile',
            'iam:AddRoleToInstanceProfile',
            'iam:RemoveRoleFromInstanceProfile',
          ],
          Resource: [
            `arn:aws:iam::*:role/${namePrefix}-cache`,
            `arn:aws:iam::*:instance-profile/${namePrefix}-cache`,
          ],
        },
        {
          Sid: 'PassCacheInstanceRoleToEc2Only',
          Effect: 'Allow',
          Action: 'iam:PassRole',
          Resource: `arn:aws:iam::*:role/${namePrefix}-cache`,
          Condition: { StringEquals: { 'iam:PassedToService': 'ec2.amazonaws.com' } },
        },
        {
          // Both the Auto Scaling Group and the ElastiCache cluster provision an AWS
          // service-linked role on first use per account if one doesn't already exist -- a fresh
          // customer role won't have this, which would otherwise be exactly the kind of
          // live-only UnauthorizedOperation surprise already hit repeatedly with EC2. Scoped by
          // condition to just these two service names, not wildcarded.
          Sid: 'ServiceLinkedRolesForAsgAndElastiCache',
          Effect: 'Allow',
          Action: 'iam:CreateServiceLinkedRole',
          Resource: '*',
          Condition: {
            StringEquals: {
              'iam:AWSServiceName': ['autoscaling.amazonaws.com', 'elasticache.amazonaws.com'],
            },
          },
        },
      ],
    },
    null,
    2,
  );
}
