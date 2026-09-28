/**
 * Copy-pasteable IAM JSON shown in the credentials-setup UI, with the workspace's own External ID
 * already substituted in. The trust policy's Principal is left as a placeholder -- Croft has no way
 * to know the customer's bootstrap IAM user ARN before they create it, since that user is what
 * they'll submit the access key for on the connect form. The role's permission policy carries the
 * full least-privilege list this feature needs and nothing else: EC2 instance/SG/VPC/subnet/
 * IGW/route-table lifecycle plus read-only AMI/AZ lookups. No iam:PassRole and no instance profile
 * grant -- the EC2 instances only run `docker compose` from user-data and never call AWS APIs
 * themselves, so they need no role of their own.
 */

const ROLE_POLICY_ACTIONS = [
  // Read-only, granted as a wildcard rather than enumerated one-by-one: the Terraform AWS
  // provider issues auxiliary Describe* calls beyond the obvious ones for a given resource (e.g.
  // aws_vpc's enable_dns_hostnames/enable_dns_support are verified via a DescribeVpcAttribute
  // read-back after ModifyVpcAttribute -- a real gap hit in practice, not a hypothetical one).
  // Describe* actions are non-mutating and free, so this costs nothing security-wise while
  // avoiding a whack-a-mole of one-more-missing-permission failures on every retry.
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

export function buildRolePolicyJson(): string {
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [...ROLE_POLICY_ACTIONS],
          Resource: '*',
        },
      ],
    },
    null,
    2,
  );
}
