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

variable "instance_type" {
  description = "Sized off the Worker node's instanceType -- the one EC2 instance this module creates runs the full compose stack (server+worker+redis), so it's sized for the resource-heavy role."
  type        = string
  default     = "m6i.large"
}

variable "allowed_ingress_cidrs" {
  description = "The workspace's own CloudCredential.allowedIngressCidrs -- who can reach the Buildfarm gRPC port. Never [\"0.0.0.0/0\"], rejected server-side before this module ever runs."
  type        = list(string)
}

variable "grpc_port" {
  description = "Published on the instance's own public IP -- fixed rather than allocated, since each workspace gets its own dedicated instance (no port-collision risk the way Docker's shared host has)."
  type        = number
  default     = 8980
}

variable "user_data" {
  description = "The EC2 bootstrap script (automation/app/render.py's render_aws_user_data()) -- installs Docker and starts the same docker-compose.yml the Docker backend renders, unmodified."
  type        = string
}
