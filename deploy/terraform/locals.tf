locals {
  vpc_id = var.vpc_id != null ? var.vpc_id : data.aws_vpc.selected[0].id

  public_subnet_ids = [
    for id, s in data.aws_subnet.vpc_subnet : id if s.map_public_ip_on_launch
  ]

  subnets_outside_excluded_azs = [
    for id, s in data.aws_subnet.vpc_subnet : id
    if !contains(var.availability_zones_exclude, s.availability_zone)
  ]

  public_subnets_usable = [
    for id in local.public_subnet_ids : id
    if contains(local.subnets_outside_excluded_azs, id)
  ]

  subnet_id_auto_public = (
    length(local.public_subnets_usable) > 0 ? sort(local.public_subnets_usable)[0] : null
  )

  subnet_id_auto_any_az = (
    length(local.subnets_outside_excluded_azs) > 0 ? sort(local.subnets_outside_excluded_azs)[0] : sort(data.aws_subnets.vpc.ids)[0]
  )

  subnet_id = var.subnet_id != null ? var.subnet_id : (
    var.associate_public_ip ? local.subnet_id_auto_public : local.subnet_id_auto_any_az
  )

  api_ingress = var.enable_unrestricted_api_ingress ? ["0.0.0.0/0"] : var.api_ingress_cidr_blocks

  name_prefix = "${var.project_name}-${var.environment}"
}
