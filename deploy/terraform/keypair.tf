data "aws_key_pair" "ssh" {
  key_name = var.ec2_key_pair_name
}
