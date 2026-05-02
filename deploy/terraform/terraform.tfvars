aws_region    = "us-east-1"
project_name  = "lootcodes-admin-api"
environment   = "production"

ecr_repository_name = "lootcodes-admin-api"
instance_type       = "t3.small"

api_port = 3000

api_ingress_cidr_blocks = ["175.32.121.29/32"]

enable_unrestricted_api_ingress = false

associate_public_ip = true
deploy_directory    = "/opt/lootcodes-admin-api"

ec2_key_pair_name = "Eneba"
