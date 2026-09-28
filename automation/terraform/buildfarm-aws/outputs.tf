output "host" {
  description = "Public IP the sample-project/CI-connect flow points Bazel at -- BuildfarmInstance.host."
  value       = aws_instance.buildfarm.public_ip
}

output "instance_id" {
  value = aws_instance.buildfarm.id
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "vpc_id" {
  value = aws_vpc.this.id
}
