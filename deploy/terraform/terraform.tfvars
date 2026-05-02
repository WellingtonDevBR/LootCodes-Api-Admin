# Local-only — enable HTTPS ALB (commit terraform.tfvars.example instead).
# DNS for lootcodes.com is external: add ACM CNAMEs from `terraform output acm_dns_validation_records`,
# then point admin-api.lootcodes.com (CNAME) at `alb_dns_name` when alias is not managed here.

aws_region    = "us-east-1"
project_name  = "lootcodes-admin-api"
environment   = "production"

ecr_repository_name = "lootcodes-admin-api"
instance_type       = "t3.small"

api_port = 3000

# When ALB is enabled, EC2 only accepts traffic from ALB SG (these CIDRs are ignored).
api_ingress_cidr_blocks         = []
enable_unrestricted_api_ingress = false

associate_public_ip = true
deploy_directory    = "/opt/lootcodes-admin-api"

ec2_key_pair_name       = "Eneba"
ssh_ingress_cidr_blocks = ["175.32.121.29/32"]

# ALB + HTTPS setup
enable_https_alb             = true
api_fqdn                     = "admin-api.lootcodes.com"
route53_zone_id              = ""
create_route53_alias_for_api = false
# ACM cert is ISSUED — HTTPS listener enabled
alb_redirect_http_to_https   = true
create_alb_https_listener    = true

# EIP: off by default when ALB is on (traffic goes through ALB DNS)
allocate_elastic_ip             = true
allocate_elastic_ip_alongside_alb = false
