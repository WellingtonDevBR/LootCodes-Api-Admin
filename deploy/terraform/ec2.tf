resource "aws_instance" "api" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  associate_public_ip_address = var.associate_public_ip

  key_name = var.ec2_key_pair_name

  depends_on = [data.aws_key_pair.ssh]

  user_data = base64encode(templatefile("${path.module}/user_data.tpl", {
    deploy_directory = var.deploy_directory
  }))

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  monitoring = true

  lifecycle {
    precondition {
      condition     = local.subnet_id != null
      error_message = "No subnet could be selected. Set var.subnet_id in terraform.tfvars, or when associate_public_ip is true ensure a map_public_ip_on_launch subnet exists outside availability_zones_exclude."
    }
    ignore_changes = [ami]
  }

  tags = {
    Name = "${local.name_prefix}-api"
  }
}
