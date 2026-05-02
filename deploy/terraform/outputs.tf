output "instance_id" {
  description = "Set GitHub Actions variable EC2_INSTANCE_IDS_ADMIN to this value."
  value       = aws_instance.api.id
}

output "elastic_ip" {
  description = "Static Elastic IP for the Admin API instance (null when ALB-only mode)."
  value       = local.create_ec2_elastic_ip ? aws_eip.api[0].public_ip : null
}

output "private_ip" {
  value = aws_instance.api.private_ip
}

output "api_url_example" {
  description = "Health check (after image deploy and .env are in place)."
  value = var.enable_https_alb ? (
    var.create_alb_https_listener ? "https://${var.api_fqdn}/health/" : "http://${aws_lb.api[0].dns_name}/health/"
  ) : (
    local.create_ec2_elastic_ip ? "http://${aws_eip.api[0].public_ip}:${var.api_port}/health/" : "http://${aws_instance.api.public_ip}:${var.api_port}/health/"
  )
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
  description = "Elastic IP allocation ID (for DNS or other references). Null when ALB-only mode."
  value       = local.create_ec2_elastic_ip ? aws_eip.api[0].allocation_id : null
}

# ---------------------------------------------------------------------------
# ALB outputs (only when enable_https_alb = true)
# ---------------------------------------------------------------------------

output "alb_dns_name" {
  description = "ALB DNS name. Point admin-api.lootcodes.com CNAME (GoDaddy) at this value."
  value       = var.enable_https_alb ? aws_lb.api[0].dns_name : null
}

output "alb_arn" {
  description = "ALB ARN."
  value       = var.enable_https_alb ? aws_lb.api[0].arn : null
}

output "alb_zone_id" {
  description = "ALB hosted zone ID (for Route53 alias records)."
  value       = var.enable_https_alb ? aws_lb.api[0].zone_id : null
}

output "target_group_arn" {
  description = "Target group ARN."
  value       = var.enable_https_alb ? aws_lb_target_group.api[0].arn : null
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN."
  value       = var.enable_https_alb ? aws_acm_certificate.api[0].arn : null
}

output "acm_dns_validation_records" {
  description = "ACM DNS validation CNAME records. Add these to GoDaddy (or Route53) before ACM can issue the cert."
  value = var.enable_https_alb ? [
    for dvo in aws_acm_certificate.api[0].domain_validation_options : {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      value  = dvo.resource_record_value
    }
  ] : []
}
