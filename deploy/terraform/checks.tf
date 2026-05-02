# Fail fast when a public IP is requested but we would have fallen back to a private subnet.

check "https_alb_requires_api_fqdn" {
  assert {
    condition     = !var.enable_https_alb || length(var.api_fqdn) > 0
    error_message = "When enable_https_alb is true, set api_fqdn (e.g. admin-api.lootcodes.com)."
  }
}

check "route53_alias_needs_zone" {
  assert {
    condition = (
      !var.create_route53_alias_for_api ||
      length(var.route53_zone_id) > 0
    )
    error_message = "create_route53_alias_for_api requires route53_zone_id, or set create_route53_alias_for_api = false and point api_fqdn at the ALB manually (see alb_dns_name output)."
  }
}

check "https_alb_requires_two_public_azs" {
  assert {
    condition = (
      !var.enable_https_alb ||
      length(local.alb_subnet_ids) >= 2
    )
    error_message = "enable_https_alb requires at least two public subnets in different availability_zones (map_public_ip_on_launch) outside availability_zones_exclude. Add subnets or set subnet_id / vpc_id appropriately."
  }
}

check "https_alb_instance_in_public_az" {
  assert {
    condition = (
      !var.enable_https_alb ||
      contains(keys(local.public_subnets_by_az), local.instance_az)
    )
    error_message = "enable_https_alb requires the Admin API instance subnet to sit in an AZ that has at least one map_public_ip_on_launch subnet (same AZ must be enabled on the internet-facing ALB)."
  }
}

check "ec2_public_subnet_when_associate_public_ip" {
  assert {
    condition = (
      var.subnet_id != null ||
      !var.associate_public_ip ||
      local.subnet_id_auto_public != null
    )
    error_message = "associate_public_ip is true but no map_public_ip_on_launch subnet exists outside availability_zones_exclude. Set subnet_id in terraform.tfvars to a subnet with a route to an Internet Gateway (SSM and ECR need HTTPS egress), or set associate_public_ip = false and provide NAT/VPC endpoints."
  }
}
