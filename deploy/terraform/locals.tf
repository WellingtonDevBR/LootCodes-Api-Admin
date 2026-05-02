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

  # ---------------------------------------------------------------------------
  # ALB subnet selection (requires ≥2 AZs when enable_https_alb — see checks.tf)
  # ---------------------------------------------------------------------------

  # One public subnet per AZ for ALB.
  public_subnets_by_az = {
    for id in local.public_subnets_usable : data.aws_subnet.vpc_subnet[id].availability_zone => id...
  }

  sorted_alb_azs = sort(keys(local.public_subnets_by_az))

  # EC2 instance AZ (ALB must enable this AZ or targets stay Target.NotInUse).
  instance_az = data.aws_subnet.vpc_subnet[local.subnet_id].availability_zone

  alb_azs_other = [
    for az in local.sorted_alb_azs : az if az != local.instance_az
  ]

  alb_azs_ordered = concat([local.instance_az], local.alb_azs_other)

  alb_azs_for_lb = (
    length(local.alb_azs_ordered) <= var.alb_availability_zone_count
    ? local.alb_azs_ordered
    : slice(local.alb_azs_ordered, 0, var.alb_availability_zone_count)
  )

  alb_subnet_ids = var.enable_https_alb ? [
    for az in local.alb_azs_for_lb : sort(local.public_subnets_by_az[az])[0]
  ] : []

  # Customer EC2 Elastic IP: useless for admin-api.example.com when DNS points at the ALB
  # (AWS cannot attach your EIP to an ALB). Default is no EC2 EIP when ALB is on unless
  # allocate_elastic_ip_alongside_alb.
  create_ec2_elastic_ip = var.allocate_elastic_ip && (
    !var.enable_https_alb || var.allocate_elastic_ip_alongside_alb
  )
}
