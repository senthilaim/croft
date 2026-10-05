# Every value here is supplied per-workspace by automation/app/terraform_manager.py via
# -var-file=terraform.tfvars.json -- nothing in this module is templated per workspace, only
# parameterized (see the plan's "Terraform integration" section).

variable "region" {
  description = "Locked to us-east-1 this release (enforced server-side in CloudCredentialsService)."
  type        = string
}

variable "workspace_id" {
  description = "Used to name/tag every resource this module creates, so teardown finds exactly this workspace's own resources and nothing else."
  type        = string
}

variable "allowed_ingress_cidrs" {
  description = "The workspace's own CloudCredential.allowedIngressCidrs -- who can reach Server's gRPC port. Never [\"0.0.0.0/0\"], rejected server-side before this module ever runs."
  type        = list(string)
}

variable "grpc_port" {
  description = "Published on Server's public IP -- fixed rather than allocated, since each workspace gets its own dedicated instance (no port-collision risk the way Docker's shared host has)."
  type        = number
  default     = 8980
}

# --- Server -----------------------------------------------------------------

variable "server_instance_type" {
  type    = string
  default = "m6i.large"
}

variable "server_user_data" {
  description = "Rendered by automation/app/render.py's render_aws_server_user_data() -- contains a __REDIS_ENDPOINT__ placeholder this module substitutes with ElastiCache's real address once it exists."
  type        = string
}

# --- Worker (Auto Scaling Group) ---------------------------------------------

variable "worker_instance_type" {
  type    = string
  default = "m6i.large"
}

variable "worker_min" {
  type    = number
  default = 1
}

variable "worker_max" {
  type    = number
  default = 1
}

variable "worker_desired" {
  description = "Maps to the Worker node's own \"replicas\" field -- the ASG's desired capacity. min=max=desired=replicas (today's fixed-size behavior) is the zero-config default; min/max only diverge when the workspace owner opts into autoscaling."
  type        = number
  default     = 1
}

variable "worker_user_data" {
  description = "Rendered by render.py's render_aws_worker_user_data() -- contains __REDIS_ENDPOINT__ and __REMOTE_CACHE_GRPC_TARGET__ placeholders this module substitutes."
  type        = string
}

# --- Redis (ElastiCache) ------------------------------------------------------

variable "redis_node_type" {
  description = "Single-node, cheapest class by default -- matches the existing staging-only posture. No replication/failover this release."
  type        = string
  default     = "cache.t3.micro"
}

# --- Remote cache tier (bazel-remote, optional) -------------------------------

variable "enable_cache" {
  description = "True when the design's Cache node has any remoteCacheTier set (\"local\", \"s3\", or \"both\"). Creates the dedicated cache instance even for \"local\" -- a shared cache benefits new Auto Scaling Group workers regardless of whether it's S3-backed."
  type        = bool
  default     = false
}

variable "enable_s3_cache" {
  description = "True when remoteCacheTier is \"s3\" or \"both\" specifically -- creates the S3 bucket plus the IAM role/instance-profile the cache instance needs to reach it."
  type        = bool
  default     = false
}

variable "cache_instance_type" {
  type    = string
  default = "m6i.large"
}

variable "cache_grpc_port" {
  description = "bazel-remote's own gRPC port (distinct from Buildfarm's grpc_port) -- internal-only, never published outside the VPC."
  type        = number
  default     = 9092
}

variable "cache_user_data" {
  description = "Rendered by render.py's render_aws_cache_user_data() when enable_cache is true -- contains a __S3_BUCKET_NAME__ placeholder (left empty when enable_s3_cache is false, giving bazel-remote a local-disk-only config). Empty string when enable_cache is false, matching aws_instance.cache's own count = 0."
  type        = string
  default     = ""
}
