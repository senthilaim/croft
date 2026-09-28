# One EC2 instance running the full Buildfarm compose stack (server+worker+redis), not one
# instance per role -- Terraform only owns what AWS resources exist, and the existing Jinja2
# templates (render.py) already produce a single combined docker-compose.yml. Splitting roles
# across hosts would mean re-expressing Buildfarm's own backplane/registration addressing for a
# multi-host topology, which the plan deliberately avoids ("reuse the existing templates
# unchanged").
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
# convenience script render_aws_user_data() relies on.
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

# A dedicated VPC per workspace, not the account default -- purely for clean resource isolation
# and lifecycle (created and destroyed with everything else this module owns), not a network-layer
# access restriction. See variables.tf's allowed_ingress_cidrs and the security group below for
# the actual access control.
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

# Public subnet with a public IP on the instance -- deliberate, not an oversight. A
# private-subnet+NAT+bastion design would break the already-shipped CI-connect flow, which needs
# the gRPC port reachable from wherever the customer's CI runs (e.g. GitHub-hosted Actions
# runners), an unpingable IP range a bastion can't accommodate. See the plan's "Networking"
# section.
resource "aws_subnet" "this" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.90.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = local.name })
}

resource "aws_route_table" "this" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.tags, { Name = local.name })
}

resource "aws_route_table_association" "this" {
  subnet_id      = aws_subnet.this.id
  route_table_id = aws_route_table.this.id
}

resource "aws_security_group" "this" {
  name = local.name
  # AWS's CreateSecurityGroup only allows a-zA-Z0-9. _-:/()#,@[]+=&;{}!$* in the description --
  # no apostrophes, no double hyphens. A real apply failed on exactly this (an apostrophe in
  # "workspace's"), so this stays plain ASCII/punctuation-light on purpose.
  description = "Croft Buildfarm workspace ${var.workspace_id}: gRPC ingress from allowed CIDRs only"
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = local.name })

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

# No instance profile / IAM role attached -- this instance only runs `docker compose up` from
# user_data and never calls an AWS API itself, so it needs no AWS permissions of its own (see the
# plan's credentials section for why the customer's role grants no iam:PassRole either).
resource "aws_instance" "buildfarm" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.this.id
  vpc_security_group_ids      = [aws_security_group.this.id]
  associate_public_ip_address = true
  user_data                   = var.user_data

  tags = merge(local.tags, { Name = local.name })
}
