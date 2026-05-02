variable "aws_region" {
  type        = string
  description = "AWS region (e.g. us-east-1)."
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Used for resource names and tags."
  default     = "lootcodes-admin-api"
}

variable "environment" {
  type        = string
  description = "Environment tag (e.g. production, staging)."
  default     = "production"
}

variable "ecr_repository_name" {
  type        = string
  description = "ECR repository name for Admin API images (must exist or be created separately)."
  default     = "lootcodes-admin-api"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type."
  default     = "t3.small"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID. Leave null to use the account default VPC."
  default     = null
}

variable "subnet_id" {
  type        = string
  description = "Subnet ID for the instance (public subnet recommended for a simple public API). Leave null to pick the first subnet in the chosen VPC."
  default     = null
}

variable "associate_public_ip" {
  type        = bool
  description = "Associate a public IPv4 address (typical for direct :3000 access without a load balancer)."
  default     = true
}

variable "api_port" {
  type        = number
  description = "TCP port exposed on the EC2 host and opened in the security group (maps 1:1 to container PORT, default 3000)."
  default     = 3000
}

variable "api_ingress_cidr_blocks" {
  type        = list(string)
  description = "CIDRs allowed to reach the API on the api_port. Use your IP /32 (e.g. ['203.0.113.10/32']) and/or a load balancer subnet. Avoid 0.0.0.0/0 unless you accept the risk."
  default     = []
}

variable "ssh_ingress_cidr_blocks" {
  type        = list(string)
  description = "If non-empty, allow SSH (22) from these CIDRs. Prefer empty and use SSM Session Manager only."
  default     = []
}

variable "ec2_key_pair_name" {
  type        = string
  description = "Name of an existing EC2 key pair in this region (must match AWS Console → Key pairs). Use Eneba if you connect with Eneba.pem. Terraform does not create or upload the .pem file."
  default     = "Eneba"

  validation {
    condition = (
      length(var.ssh_ingress_cidr_blocks) == 0 ||
      (length(var.ec2_key_pair_name) > 0)
    )
    error_message = "When ssh_ingress_cidr_blocks is set, ec2_key_pair_name must be non-empty."
  }
}

variable "deploy_directory" {
  type        = string
  description = "Path on the instance for docker-compose.prod.yml and .env (must match GitHub Actions EC2_DEPLOY_DIR_ADMIN)."
  default     = "/opt/lootcodes-admin-api"
}

variable "root_volume_size_gb" {
  type        = number
  description = "Root EBS volume size (GiB)."
  default     = 30
}

variable "enable_unrestricted_api_ingress" {
  type        = bool
  description = "If true, allow 0.0.0.0/0 on the api_port (not recommended for production)."
  default     = false
}

variable "availability_zones_exclude" {
  type        = list(string)
  description = "Subnets in these AZs are skipped when auto-picking a subnet (e.g. us-east-1e often lacks t3 capacity)."
  default     = ["us-east-1e"]
}

variable "extra_tags" {
  type        = map(string)
  description = "Additional tags for all tagged resources."
  default     = {}
}

# ---------------------------------------------------------------------------
# ALB / HTTPS / ACM
# ---------------------------------------------------------------------------

variable "allocate_elastic_ip" {
  type        = bool
  description = "Create a customer-managed Elastic IP on the Admin API EC2 instance. When enable_https_alb is true, the public hostname should target the ALB, not this IP—set allocate_elastic_ip_alongside_alb only if you still need direct EC2 access on a static IP."
  default     = true
}

variable "allocate_elastic_ip_alongside_alb" {
  type        = bool
  description = "When both allocate_elastic_ip and enable_https_alb are true, set true to attach the Elastic IP to EC2 anyway. Default false avoids an extra static IPv4: traffic to admin-api FQDN should use the ALB (AWS does not support linking your EIP to an Application Load Balancer)."
  default     = false
}

variable "alb_availability_zone_count" {
  type        = number
  description = "How many AZs the internet-facing ALB uses (min 2). Always includes the API instance AZ first, then other public AZs. Each AZ adds AWS-managed ALB addresses."
  default     = 2

  validation {
    condition     = var.alb_availability_zone_count >= 2 && var.alb_availability_zone_count <= 8
    error_message = "alb_availability_zone_count must be between 2 and 8."
  }
}

variable "enable_https_alb" {
  type        = bool
  description = "If true, create an internet-facing ALB with ACM TLS, HTTP→HTTPS redirect, and Route53 DNS validation. EC2 :3000 accepts traffic only from the ALB security group."
  default     = false
}

variable "api_fqdn" {
  type        = string
  description = "Public hostname for the Admin API (e.g. admin-api.lootcodes.com). Required when enable_https_alb is true. Used for ACM cert and optional Route53 alias."
  default     = ""
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for the api_fqdn parent zone (e.g. Z... for lootcodes.com). If empty, create the ACM DNS validation CNAME at your DNS provider (see acm_dns_validation_records output), then re-run apply."
  default     = ""
}

variable "create_route53_alias_for_api" {
  type        = bool
  description = "When enable_https_alb is true, create an A (alias) record from api_fqdn to the ALB. Set false if you manage DNS elsewhere (update manually after apply)."
  default     = false
}

variable "alb_redirect_http_to_https" {
  type        = bool
  description = "When enable_https_alb is true, port 80 behavior: true = 301 redirect to HTTPS (use only after ACM cert is ISSUED and :443 listener exists); false = forward to targets so HTTP works while cert is pending."
  default     = false
}

variable "create_alb_https_listener" {
  type        = bool
  description = "When enable_https_alb is true, create ACM validation wait + :443 listener. Set false until the ACM DNS validation CNAME exists and ACM shows ISSUED (or use after first apply, then set true)."
  default     = false
}
