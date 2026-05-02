output "instance_id" {
  description = "Set GitHub Actions variable EC2_INSTANCE_IDS_ADMIN to this value."
  value       = aws_instance.api.id
}

output "public_ip" {
  description = "Public IPv4 (if associate_public_ip is true and subnet routes to IGW)."
  value       = aws_instance.api.public_ip
}

output "private_ip" {
  value = aws_instance.api.private_ip
}

output "api_url_example" {
  description = "Health check (after image deploy and .env are in place)."
  value       = "http://${aws_instance.api.public_ip}:${var.api_port}/health/"
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
