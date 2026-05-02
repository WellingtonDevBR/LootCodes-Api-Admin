resource "aws_eip" "api" {
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-api-eip"
  }
}

resource "aws_eip_association" "api" {
  allocation_id = aws_eip.api.id
  instance_id   = aws_instance.api.id
}
