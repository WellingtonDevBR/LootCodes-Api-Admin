data "aws_caller_identity" "current" {}

data "aws_vpc" "selected" {
  count   = var.vpc_id == null ? 1 : 0
  default = true
}

data "aws_subnets" "vpc" {
  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }
}

data "aws_subnet" "vpc_subnet" {
  for_each = toset(data.aws_subnets.vpc.ids)
  id       = each.value
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
