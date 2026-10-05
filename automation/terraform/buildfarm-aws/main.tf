# Horizontally-scalable AWS Buildfarm: Server (one dedicated instance, public-facing), Worker (an
# Auto Scaling Group, private), Redis (AWS-managed ElastiCache, private), and an optional dedicated
# cache instance running bazel-remote (private) fronting an optional S3 bucket. This replaces the
# earlier single-shared-instance design -- an ASG of workers forced the split: Server (the one
# stable public endpoint) and Redis (the one shared backplane every worker must agree on) can't
# each be duplicated across N worker instances. render.py still owns how each instance's own
# config.yml/docker-compose.yml is rendered; this module only owns what AWS resources exist and
# wires a handful of cross-resource placeholders (Redis's endpoint, the cache instance's address,
# the S3 bucket name) into each instance's user-data at apply time, since those values only exist
# once Terraform creates the resources that produce them.
#
# Credentials come only from AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN in the
# terraform subprocess's environment (see automation/app/terraform_manager.py) -- never written
# here, never in a .tfvars file, so they never land in this module's state either.
provider "aws" {
  region = var.region
}

locals {
  name = "croft-${var.workspace_id}"
  tags = {
    ManagedBy   = "croft"
    Workspace   = var.workspace_id
    Environment = "staging"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# Ubuntu 22.04 LTS, Canonical's own account -- a well-known, stable choice for the get.docker.com
# convenience script render_aws_*_user_data() relies on.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = "10.90.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = local.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = local.name })
}

# Public: Server only. Deliberate, not an oversight -- the already-shipped CI-connect flow needs
# the gRPC port reachable from wherever the customer's CI runs (e.g. GitHub-hosted Actions
# runners), an unpingable IP range a private design can't accommodate.
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.90.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "${local.name}-public" })
}

# Private: Worker ASG, the optional cache instance, ElastiCache. None of these are ever reached
# from outside the VPC -- coordination is via the Redis backplane and internal CAS/ByteStream
# traffic only, never a direct inbound connection from a client or CI runner (only Server is
# client-facing). NAT Gateway gives them outbound internet (Docker Hub pulls, apt, S3) without a
# public IP or any inbound route.
resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = "10.90.2.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = merge(local.tags, { Name = "${local.name}-private" })
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = local.name })
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  tags          = merge(local.tags, { Name = local.name })
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.tags, { Name = "${local.name}-public" })
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }

  tags = merge(local.tags, { Name = "${local.name}-private" })
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "server" {
  name = "${local.name}-server"
  # AWS's CreateSecurityGroup only allows a-zA-Z0-9. _-:/()#,@[]+=&;{}!$* in the description -- no
  # apostrophes, no double hyphens. A real apply failed on exactly this once, so this stays plain
  # ASCII/punctuation-light on purpose.
  description = "Croft Buildfarm workspace ${var.workspace_id}: gRPC ingress from allowed CIDRs only"
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${local.name}-server" })

  ingress {
    description = "Buildfarm gRPC"
    from_port   = var.grpc_port
    to_port     = var.grpc_port
    protocol    = "tcp"
    cidr_blocks = var.allowed_ingress_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Worker/Redis/Cache: no ingress from outside the VPC at all. This assumes Buildfarm's SHARD
# backend never needs a client/CI runner to dial a worker directly (coordination is entirely via
# the Redis backplane) -- confirmed against Buildfarm's own upstream docs/example config, not
# against a real running cluster's wire traffic; flagged as a real assumption worth re-checking if
# builds ever fail in a way that looks like a blocked worker-bound connection.
resource "aws_security_group" "internal" {
  name        = "${local.name}-internal"
  description = "Croft Buildfarm workspace ${var.workspace_id}: worker/redis/cache, no inbound from outside the VPC"
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${local.name}-internal" })

  ingress {
    description = "Within this workspace's own private resources"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    self        = true
  }
  ingress {
    description     = "From Server (backplane registration / CAS traffic)"
    from_port       = 0
    to_port         = 0
    protocol        = "-1"
    security_groups = [aws_security_group.server.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------
# Redis backplane (AWS-managed, since Worker is now a fleet rather than one co-located container)
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "redis" {
  name       = local.name
  subnet_ids = [aws_subnet.private.id]
  tags       = local.tags
}

# Single-node, cheapest class -- matches the existing staging-only posture (AWS_STAGING_INSTANCE_TYPES
# is similarly the smallest 1-2 catalog entries). Multi-AZ/failover (a replication group) is
# explicitly out of scope this release.
resource "aws_elasticache_cluster" "redis" {
  cluster_id         = "${local.name}-redis"
  engine             = "redis"
  node_type          = var.redis_node_type
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.internal.id]
  tags               = local.tags
}

# ---------------------------------------------------------------------------
# Server -- one dedicated instance, the only client-facing endpoint
# ---------------------------------------------------------------------------

# No instance profile / IAM role -- Server only runs `docker compose up` from user_data and never
# calls an AWS API itself (see the plan's credentials section for why the customer's bootstrap
# role grants no broader iam:PassRole either).
resource "aws_instance" "server" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.server_instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.server.id]
  associate_public_ip_address = true

  # __REDIS_ENDPOINT__ is a placeholder render.py's render_aws_server_user_data() leaves in the
  # template -- only Terraform knows ElastiCache's real address, since it doesn't exist until this
  # apply creates it.
  user_data = replace(var.server_user_data, "__REDIS_ENDPOINT__", aws_elasticache_cluster.redis.cache_nodes[0].address)

  tags = merge(local.tags, { Name = "${local.name}-server" })
}

# ---------------------------------------------------------------------------
# Worker -- Auto Scaling Group
# ---------------------------------------------------------------------------

resource "aws_launch_template" "worker" {
  name_prefix   = "${local.name}-worker-"
  image_id      = data.aws_ami.ubuntu.id
  instance_type = var.worker_instance_type

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.internal.id]
  }

  # Same placeholder-substitution pattern as Server's user_data, plus __REMOTE_CACHE_GRPC_TARGET__
  # (empty string when no cache tier is enabled -- render_config_yml already treats an empty/absent
  # target as "no GRPC storage entry", see automation/templates/config.yml.j2).
  user_data = base64encode(
    replace(
      replace(var.worker_user_data, "__REDIS_ENDPOINT__", aws_elasticache_cluster.redis.cache_nodes[0].address),
      "__REMOTE_CACHE_GRPC_TARGET__",
      var.enable_cache ? "grpc://${try(aws_instance.cache[0].private_ip, "")}:${var.cache_grpc_port}" : ""
    )
  )

  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.tags, { Name = "${local.name}-worker" })
  }
}

resource "aws_autoscaling_group" "worker" {
  name                = "${local.name}-worker"
  min_size            = var.worker_min
  max_size            = var.worker_max
  desired_capacity    = var.worker_desired
  vpc_zone_identifier = [aws_subnet.private.id]

  launch_template {
    id      = aws_launch_template.worker.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${local.name}-worker"
    propagate_at_launch = true
  }
  tag {
    key                 = "ManagedBy"
    value               = "croft"
    propagate_at_launch = true
  }
  tag {
    key                 = "Workspace"
    value               = var.workspace_id
    propagate_at_launch = true
  }
  tag {
    key                 = "Environment"
    value               = "staging"
    propagate_at_launch = true
  }
}

# Simplest defensible default for a staging tier: target-tracking on CPU, no custom CloudWatch
# metric, no step-scaling complexity.
resource "aws_autoscaling_policy" "worker_cpu" {
  name                   = "${local.name}-worker-cpu"
  autoscaling_group_name = aws_autoscaling_group.worker.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60
  }
}

# ---------------------------------------------------------------------------
# Optional dedicated cache instance (bazel-remote), optional S3 backing
# ---------------------------------------------------------------------------

# Created whenever the design's Cache node has any remoteCacheTier set -- even "local" (no S3)
# benefits from a shared instance: new Auto Scaling Group workers start with a warm shared cache
# instead of a cold local disk.
resource "aws_instance" "cache" {
  count = var.enable_cache ? 1 : 0

  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.cache_instance_type
  subnet_id                   = aws_subnet.private.id
  vpc_security_group_ids      = [aws_security_group.internal.id]
  associate_public_ip_address = false
  iam_instance_profile        = var.enable_s3_cache ? aws_iam_instance_profile.cache[0].name : null

  # __S3_BUCKET_NAME__ is empty when enable_s3_cache is false -- render_aws_cache_user_data()
  # leaves bazel-remote's --s3.* flags off entirely in that case (local disk only).
  user_data = replace(var.cache_user_data, "__S3_BUCKET_NAME__", var.enable_s3_cache ? aws_s3_bucket.cache[0].bucket : "")

  tags = merge(local.tags, { Name = "${local.name}-cache" })
}

resource "aws_s3_bucket" "cache" {
  count  = var.enable_s3_cache ? 1 : 0
  bucket = "${local.name}-cache"
  tags   = local.tags
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cache" {
  count  = var.enable_s3_cache ? 1 : 0
  bucket = aws_s3_bucket.cache[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CAS content is content-addressed and inherently disposable/regeneratable -- bound runaway
# storage cost rather than keeping every blob forever. No versioning: immutable-by-construction
# objects get no benefit from it, only extra cost.
resource "aws_s3_bucket_lifecycle_configuration" "cache" {
  count  = var.enable_s3_cache ? 1 : 0
  bucket = aws_s3_bucket.cache[0].id

  rule {
    id     = "expire-old-cas-objects"
    status = "Enabled"
    filter {}

    expiration {
      days = 30
    }
  }
}

# The only instance in this module that gets an IAM role -- bazel-remote's --s3.auth_method=iam_role
# needs *some* way to authenticate to S3, and an instance-profile role is the standard secure
# mechanism (the alternative, static AWS credentials embedded in user-data, is far worse). Scoped
# tightly to exactly this one bucket; nothing else in the account.
resource "aws_iam_role" "cache" {
  count = var.enable_s3_cache ? 1 : 0
  name  = "${local.name}-cache"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "cache_s3" {
  count = var.enable_s3_cache ? 1 : 0
  name  = "${local.name}-cache-s3"
  role  = aws_iam_role.cache[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.cache[0].arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.cache[0].arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "cache" {
  count = var.enable_s3_cache ? 1 : 0
  name  = "${local.name}-cache"
  role  = aws_iam_role.cache[0].name
}
