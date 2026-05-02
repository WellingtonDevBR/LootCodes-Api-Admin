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
