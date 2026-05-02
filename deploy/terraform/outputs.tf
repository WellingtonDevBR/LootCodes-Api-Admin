output "instance_id" {
  description = "Set GitHub Actions variable EC2_INSTANCE_IDS_ADMIN to this value."
  value       = aws_instance.api.id
}

output "elastic_ip" {
  description = "Static Elastic IP for the Admin API instance."
  value       = aws_eip.api.public_ip
}

output "private_ip" {
  value = aws_instance.api.private_ip
}

output "api_url_example" {
  description = "Health check (after image deploy and .env are in place)."
  value       = "http://${aws_eip.api.public_ip}:${var.api_port}/health/"
}

output "ssm_session_hint" {
  description = "Connect without SSH using Session Manager."
  value       = "aws ssm start-session --target ${aws_instance.api.id} --region ${var.aws_region}"
}

output "security_group_id" {
  value = aws_security_group.api.id
}

output "iam_instance_profile_arn" {
  value = aws_iam_instance_profile.ec2.arn
}

output "eip_allocation_id" {
  description = "Elastic IP allocation ID (for DNS or other references)."
  value       = aws_eip.api.allocation_id
}
