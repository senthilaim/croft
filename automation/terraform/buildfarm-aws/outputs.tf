output "host" {
  description = "What the sample-project/CI-connect flow points Bazel at -- BuildfarmInstance.host. Phase 0: Server's NLB DNS name (was the instance's own public IP pre-Multi-AZ) -- consumed everywhere downstream as an opaque string interpolated into grpc://host:port, so this swap is a no-op for the rest of the app."
  value       = aws_lb.server.dns_name
}

output "server_instance_id" {
  value = aws_instance.server.id
}

output "worker_asg_name" {
  value = aws_autoscaling_group.worker.name
}

output "redis_endpoint" {
  description = "The replication group's primary endpoint -- a stable DNS name AWS auto-repoints to the new primary after a failover, so __REDIS_ENDPOINT__'s substitution keeps working unchanged across a real failover with no re-apply."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_replication_group_id" {
  value = aws_elasticache_replication_group.redis.id
}

output "cache_instance_id" {
  value = try(aws_instance.cache[0].id, null)
}

output "cache_bucket_name" {
  value = try(aws_s3_bucket.cache[0].bucket, null)
}

output "security_group_id" {
  value = aws_security_group.server.id
}

output "vpc_id" {
  value = aws_vpc.this.id
}

# --- Added for the Designer's AWS architecture diagram -- purely additive, the 8 outputs above
# keep their exact existing contract (host especially) unchanged. -----------------------------

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

# Pinned to AZ "a" -- the diagram/topology model one illustrative public+private subnet pair;
# AZ "b" exists for real HA (the ASG/ElastiCache span both) but isn't separately surfaced here.
output "public_subnet_id" {
  value = aws_subnet.public["a"].id
}

output "public_subnet_cidr" {
  value = aws_subnet.public["a"].cidr_block
}

output "private_subnet_id" {
  value = aws_subnet.private["a"].id
}

output "private_subnet_cidr" {
  value = aws_subnet.private["a"].cidr_block
}

output "internet_gateway_id" {
  value = aws_internet_gateway.this.id
}

output "nat_gateway_id" {
  value = aws_nat_gateway.this["a"].id
}

output "nat_gateway_public_ip" {
  value = aws_eip.nat["a"].public_ip
}

output "internal_security_group_id" {
  value = aws_security_group.internal.id
}

output "worker_launch_template_id" {
  value = aws_launch_template.worker.id
}

output "cache_instance_private_ip" {
  value = try(aws_instance.cache[0].private_ip, null)
}

output "cache_iam_role_arn" {
  value = try(aws_iam_role.cache[0].arn, null)
}
