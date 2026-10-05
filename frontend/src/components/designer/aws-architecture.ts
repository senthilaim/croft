import type {
  AwsTopology,
  BuildfarmConfig,
  CacheNodeConfig,
  WorkerNodeConfig,
} from "@croft/shared-types";

/** One box in the AWS architecture diagram. `parentId` nests it inside a vpc/subnet box (React
 * Flow's own parentId/extent grouping, not a custom layout engine). `liveId` is the real AWS
 * resource id once provisioned -- undefined/null means "design only, not provisioned yet". */
export interface ArchResourceNode {
  id: string;
  kind:
    | "vpc"
    | "subnet"
    | "igw"
    | "nat"
    | "nlb"
    | "ec2-server"
    | "asg-worker"
    | "elasticache"
    | "ec2-cache"
    | "s3";
  label: string;
  parentId?: string;
  /** "external" = outside the VPC (S3 is a global service, not a VPC resource). */
  zone?: "public" | "private" | "external";
  detail?: string;
  liveId?: string | null;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface AwsArchitecture {
  nodes: ArchResourceNode[];
  edges: ArchEdge[];
}

/** Mirrors automation/terraform/buildfarm-aws/main.tf's own conditionals exactly -- not a
 * reinterpretation. Same two booleans AwsBackend.provision() already computes from the Cache
 * node's config. */
function cacheFlags(config: BuildfarmConfig): { enableCache: boolean; enableS3: boolean } {
  const cacheNode = config.nodes.find((n) => n.type === "cache");
  const tier = cacheNode ? (cacheNode.config as CacheNodeConfig).remoteCacheTier : undefined;
  return { enableCache: tier !== undefined, enableS3: tier === "s3" || tier === "both" };
}

/** Derives the real AWS architecture diagram from a Buildfarm design -- available instantly for
 * any AWS-provider design, with no AWS connection needed. When `topology` is passed and has a
 * truthy `vpcId` (i.e. actually provisioned, not torn-down/absent), each node's `liveId` is filled
 * in from the matching AwsTopology field so the diagram can render a live-status overlay; otherwise
 * every node renders design-only (no liveId). */
export function deriveAwsArchitecture(
  config: BuildfarmConfig,
  topology?: AwsTopology | null,
): AwsArchitecture {
  const live = topology?.vpcId ? topology : null;
  const workerNode = config.nodes.find((n) => n.type === "worker");
  const workerCfg = (workerNode?.config ?? {}) as WorkerNodeConfig;
  const desired = Math.max(1, Number(workerCfg.replicas) || 1);
  const min = workerCfg.minReplicas ?? desired;
  const max = workerCfg.maxReplicas ?? desired;
  const { enableCache, enableS3 } = cacheFlags(config);

  const nodes: ArchResourceNode[] = [
    { id: "vpc", kind: "vpc", label: "VPC", detail: live?.vpcCidr ?? "10.90.0.0/16", liveId: live?.vpcId },
    {
      id: "public-subnet", kind: "subnet", label: "Public subnet", parentId: "vpc", zone: "public",
      detail: live?.publicSubnetCidr ?? "10.90.1.0/24", liveId: live?.publicSubnetId,
    },
    {
      id: "private-subnet", kind: "subnet", label: "Private subnet", parentId: "vpc", zone: "private",
      detail: live?.privateSubnetCidr ?? "10.90.2.0/24", liveId: live?.privateSubnetId,
    },
    {
      id: "igw", kind: "igw", label: "Internet Gateway", parentId: "public-subnet", zone: "public",
      liveId: live?.internetGatewayId,
    },
    {
      id: "nat", kind: "nat", label: "NAT Gateway", parentId: "public-subnet", zone: "public",
      detail: live?.natGatewayPublicIp, liveId: live?.natGatewayId,
    },
    {
      id: "nlb", kind: "nlb", label: "Network Load Balancer", parentId: "public-subnet", zone: "public",
      detail: "stable endpoint, health checks", liveId: live?.loadBalancerDnsName,
    },
    {
      id: "server", kind: "ec2-server", label: "Server", parentId: "public-subnet", zone: "public",
      detail: "single instance -- no failover yet", liveId: live?.serverInstanceId,
    },
    {
      id: "worker-asg", kind: "asg-worker", label: "Worker ASG", parentId: "private-subnet", zone: "private",
      detail: `min ${min} / desired ${desired} / max ${max} · 2 AZs`, liveId: live?.workerAsgName,
    },
    {
      id: "redis", kind: "elasticache", label: "ElastiCache (Redis)", parentId: "private-subnet", zone: "private",
      detail: "Multi-AZ, auto-failover", liveId: live?.redisEndpoint,
    },
  ];

  const edges: ArchEdge[] = [
    // Public subnet's own route to the IGW is implied by containment (igw is drawn inside the
    // public-subnet box) -- no edge needed, would just be a redundant line entirely within one box.
    { id: "e-nat-igw", source: "nat", target: "igw", label: "egress" },
    { id: "e-priv-nat", source: "private-subnet", target: "nat", label: "route 0.0.0.0/0" },
    { id: "e-nlb-server", source: "nlb", target: "server", label: "TCP:8980" },
    // Distinct labels even though both are "backplane" traffic -- Server's edge is longer on
    // screen now that it routes past the NLB, and an identical label on both collided visually.
    { id: "e-server-redis", source: "server", target: "redis", label: "registers" },
    { id: "e-worker-redis", source: "worker-asg", target: "redis", label: "backplane" },
  ];

  if (enableCache) {
    nodes.push({
      id: "cache", kind: "ec2-cache", label: "Cache (bazel-remote)", parentId: "private-subnet", zone: "private",
      detail: enableS3 ? "S3-backed" : "local disk only", liveId: live?.cacheInstanceId,
    });
    edges.push({ id: "e-worker-cache", source: "worker-asg", target: "cache", label: "L2 lookups" });

    if (enableS3) {
      nodes.push({
        id: "s3", kind: "s3", label: "S3 bucket", zone: "external", liveId: live?.cacheBucketName,
      });
      edges.push({ id: "e-cache-s3", source: "cache", target: "s3", label: "via NAT" });
    }
  }

  return { nodes, edges };
}
