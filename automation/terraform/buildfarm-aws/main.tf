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

  # Two AZs -- the minimum ElastiCache's own Multi-AZ replication group needs, and roughly half
  # the NAT Gateway cost of three. A third AZ later is just another entry in this map; every
  # resource below is for_each'd off it rather than hand-duplicated per AZ.
  azs = {
    a = { az = data.aws_availability_zones.available.names[0], public_cidr = "10.90.1.0/24", private_cidr = "10.90.2.0/24" }
    b = { az = data.aws_availability_zones.available.names[1], public_cidr = "10.90.3.0/24", private_cidr = "10.90.4.0/24" }
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

# Public: Server (+ its NLB) only. Deliberate, not an oversight -- the already-shipped CI-connect
# flow needs the gRPC port reachable from wherever the customer's CI runs (e.g. GitHub-hosted
# Actions runners), an unpingable IP range a private design can't accommodate. One per AZ so each
# AZ's NAT Gateway has somewhere to live; Server itself stays pinned to AZ "a" (see aws_instance.server).
resource "aws_subnet" "public" {
  for_each                = local.azs
  vpc_id                  = aws_vpc.this.id
  cidr_block              = each.value.public_cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "${local.name}-public-${each.key}" })
}

# Private: Worker ASG (spans both AZs), ElastiCache (Multi-AZ replication group), and the optional
# cache instance (pinned to AZ "a", still a singular non-HA component). None of these are ever
# reached from outside the VPC -- coordination is via the Redis backplane and internal CAS/ByteStream
# traffic only, never a direct inbound connection from a client or CI runner (only Server is
# client-facing). Each AZ's own NAT Gateway gives it outbound internet (Docker Hub pulls, apt, S3)
# without a public IP or any inbound route.
resource "aws_subnet" "private" {
  for_each          = local.azs
  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value.private_cidr
  availability_zone = each.value.az
  tags              = merge(local.tags, { Name = "${local.name}-private-${each.key}" })
}

resource "aws_eip" "nat" {
  for_each = local.azs
  domain   = "vpc"
  tags     = merge(local.tags, { Name = "${local.name}-${each.key}" })
}

resource "aws_nat_gateway" "this" {
  for_each      = local.azs
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
  tags          = merge(local.tags, { Name = "${local.name}-${each.key}" })
  depends_on    = [aws_internet_gateway.this]
}

# Singular and shared across both public subnets -- the Internet Gateway is a single regional
# resource, not AZ-bound, so there's no reason to duplicate this route table the way the private
# ones are (those differ per AZ because each routes through its own AZ's NAT Gateway).
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.tags, { Name = "${local.name}-public" })
}

resource "aws_route_table_association" "public" {
  for_each       = local.azs
  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}

# Per-AZ on purpose: each private subnet routes through its own AZ's NAT Gateway, avoiding
# cross-AZ NAT data-transfer charges -- the actual mechanism that makes "a NAT Gateway per AZ"
# meaningful rather than decorative.
resource "aws_route_table" "private" {
  for_each = local.azs
  vpc_id   = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[each.key].id
  }

  tags = merge(local.tags, { Name = "${local.name}-private-${each.key}" })
}

resource "aws_route_table_association" "private" {
  for_each       = local.azs
  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
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
  subnet_ids = [for s in aws_subnet.private : s.id]
  tags       = local.tags
}

# Multi-AZ replication group -- cheapest class (matches the existing staging-only posture;
# AWS_STAGING_INSTANCE_TYPES is similarly the smallest 1-2 catalog entries), but with automatic
# failover now that the private subnets span two AZs. num_cache_clusters = 2 (primary + one
# replica) is the minimum that enables failover at all.
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.name}-redis"
  description                = "Croft Buildfarm workspace ${var.workspace_id} Redis backplane"
  engine                     = "redis"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  port                       = 6379
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.internal.id]
  tags                       = local.tags
}

# ---------------------------------------------------------------------------
# Server -- one dedicated instance, the only client-facing endpoint
# ---------------------------------------------------------------------------

# No instance profile / IAM role -- Server only runs `docker compose up` from user_data and never
# calls an AWS API itself (see the plan's credentials section for why the customer's bootstrap
# role grants no broader iam:PassRole either). Pinned to AZ "a" -- Server stays a single instance
# this phase (behind the NLB below for a stable endpoint + health checks, not real failover);
# making Server itself redundant is a deliberate later decision, not this one.
resource "aws_instance" "server" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.server_instance_type
  subnet_id                   = aws_subnet.public["a"].id
  vpc_security_group_ids      = [aws_security_group.server.id]
  associate_public_ip_address = true

  # __REDIS_ENDPOINT__ is a placeholder render.py's render_aws_server_user_data() leaves in the
  # template -- only Terraform knows ElastiCache's real address, since it doesn't exist until this
  # apply creates it. primary_endpoint_address is a stable DNS name the replication group
  # auto-repoints to the new primary after a failover, so this substitution keeps working across a
  # real failover with no re-apply needed.
  user_data = replace(var.server_user_data, "__REDIS_ENDPOINT__", aws_elasticache_replication_group.redis.primary_endpoint_address)

  # The subnet existing doesn't mean its route to the Internet Gateway exists yet -- subnet and
  # route-table-association are sibling resources with no attribute-level reference between them,
  # so without this, Terraform's graph can legally launch this instance before aws_route_table_
  # association.public["a"] completes. user_data's first real command is a `curl | sh` under
  # `set -euo pipefail` with no retry (see aws-user-data.sh.j2) -- launching into a subnet with no
  # route out yet means that curl fails once and the instance never finishes bootstrapping, with
  # `terraform apply` still reporting success (it only waits for "running", not for user_data).
  depends_on = [aws_route_table_association.public["a"]]

  tags = merge(local.tags, { Name = "${local.name}-server" })
}

# ---------------------------------------------------------------------------
# Server's Network Load Balancer -- a stable DNS endpoint + AWS-managed health checks, not real
# failover (Server stays a single instance this phase). An NLB, not an ALB: Buildfarm's gRPC port
# serves remote execution, remote cache and ByteStream all on one plain gRPC port -- raw TCP, not
# HTTP path-routing, so pure L4 passthrough is the right fit and needs no protocol-aware listener
# config the way an ALB's gRPC support would. Lives in the same AZ "a" public subnet as Server.
# ---------------------------------------------------------------------------

resource "aws_lb" "server" {
  name               = "${local.name}-server"
  load_balancer_type = "network"
  internal           = false
  subnets            = [aws_subnet.public["a"].id]
  tags               = merge(local.tags, { Name = "${local.name}-server" })
}

resource "aws_lb_target_group" "server" {
  name     = "${local.name}-server"
  port     = var.grpc_port
  protocol = "TCP"
  vpc_id   = aws_vpc.this.id

  health_check {
    protocol = "TCP"
  }

  tags = local.tags
}

resource "aws_lb_target_group_attachment" "server" {
  target_group_arn = aws_lb_target_group.server.arn
  target_id        = aws_instance.server.id
  port             = var.grpc_port
}

resource "aws_lb_listener" "server" {
  load_balancer_arn = aws_lb.server.arn
  port              = var.grpc_port
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
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
      replace(var.worker_user_data, "__REDIS_ENDPOINT__", aws_elasticache_replication_group.redis.primary_endpoint_address),
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
  vpc_zone_identifier = [for s in aws_subnet.private : s.id]

  launch_template {
    id      = aws_launch_template.worker.id
    version = "$Latest"
  }

  # Same reasoning as aws_instance.server's depends_on, but for the NAT path: the private subnet
  # existing doesn't mean its route through the NAT Gateway exists yet. Without this, the ASG can
  # launch instances before aws_route_table_association.private completes, and each one's user_data
  # (same no-retry `curl | sh` under set -euo pipefail) fails permanently on first boot.
  depends_on = [aws_route_table_association.private]

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
  subnet_id                   = aws_subnet.private["a"].id
  vpc_security_group_ids      = [aws_security_group.internal.id]
  associate_public_ip_address = false
  iam_instance_profile        = var.enable_s3_cache ? aws_iam_instance_profile.cache[0].name : null

  # __S3_BUCKET_NAME__ is empty when enable_s3_cache is false -- render_aws_cache_user_data()
  # leaves bazel-remote's --s3.* flags off entirely in that case (local disk only).
  user_data = replace(var.cache_user_data, "__S3_BUCKET_NAME__", var.enable_s3_cache ? aws_s3_bucket.cache[0].bucket : "")

  # Same NAT-routing race as the Worker ASG -- this instance is also in the private subnet and
  # also runs the no-retry `curl | sh` bootstrap script. Narrowed to AZ "a" since that's where
  # this (still singular, non-HA) instance actually lives.
  depends_on = [aws_route_table_association.private["a"]]

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
