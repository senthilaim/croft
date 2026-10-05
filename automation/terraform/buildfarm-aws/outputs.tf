output "host" {
  description = "Public IP the sample-project/CI-connect flow points Bazel at -- BuildfarmInstance.host. Unchanged contract from the single-instance design: still just Server's own address."
  value       = aws_instance.server.public_ip
}

output "server_instance_id" {
  value = aws_instance.server.id
}

output "worker_asg_name" {
  value = aws_autoscaling_group.worker.name
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
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
