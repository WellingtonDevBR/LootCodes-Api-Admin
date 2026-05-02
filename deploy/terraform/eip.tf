# Single *customer* Elastic IP for the Admin API EC2 instance (stable across stop/start).
#
# Internet-facing Application Load Balancers do NOT use this resource. AWS creates
# separate "Elastic IPs" in the EC2 console for each ALB subnet/AZ (see ServiceManaged
# = "alb" in describe-addresses). Those are required for the ALB; you cannot attach
# one shared customer EIP to the ALB.
#
# When enable_https_alb is true, admin-api.lootcodes.com should point at the ALB, not
# this EIP. Set allocate_elastic_ip_alongside_alb = true only if you still need direct
# EC2 access on a static IP (e.g. for SSH, debugging).

resource "aws_eip" "api" {
  count  = local.create_ec2_elastic_ip ? 1 : 0
  domain = "vpc"

  tags = merge(
    {
      Name        = "${local.name_prefix}-ec2-eip"
      Description = "LootCodes Admin API EC2 — keep; release orphans manually"
    },
    var.extra_tags,
  )

  depends_on = [aws_instance.api]
}

resource "aws_eip_association" "api" {
  count         = local.create_ec2_elastic_ip ? 1 : 0
  instance_id   = aws_instance.api.id
  allocation_id = aws_eip.api[0].id
}
