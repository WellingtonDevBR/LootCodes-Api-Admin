# ---------------------------------------------------------------------------
# Application Load Balancer + ACM Certificate for Admin API
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  count = var.enable_https_alb ? 1 : 0

  name_prefix = "${local.name_prefix}-alb-"
  description = "ALB: HTTP redirect to HTTPS; HTTPS to Admin API target group"
  vpc_id      = local.vpc_id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "To targets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [description]
  }

  tags = {
    Name = "${local.name_prefix}-alb-sg"
  }
}

resource "aws_lb" "api" {
  count = var.enable_https_alb ? 1 : 0

  name                       = substr(replace("${local.name_prefix}-alb", "_", "-"), 0, 32)
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb[0].id]
  subnets                    = local.alb_subnet_ids
  drop_invalid_header_fields = true

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_lb_target_group" "api" {
  count = var.enable_https_alb ? 1 : 0

  name        = substr(replace("${local.name_prefix}-tg", "_", "-"), 0, 32)
  port        = var.api_port
  protocol    = "HTTP"
  vpc_id      = local.vpc_id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health/"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${local.name_prefix}-tg"
  }
}

resource "aws_lb_target_group_attachment" "api" {
  count = var.enable_https_alb ? 1 : 0

  target_group_arn = aws_lb_target_group.api[0].arn
  target_id        = aws_instance.api.id
  port             = var.api_port
}

# ---------------------------------------------------------------------------
# ACM Certificate (DNS validation via GoDaddy or Route53)
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "api" {
  count = var.enable_https_alb ? 1 : 0

  domain_name       = var.api_fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.name_prefix}-cert"
  }
}

# Optional Route53 validation (skip if using GoDaddy — add CNAME manually).
resource "aws_route53_record" "cert_validation" {
  for_each = var.enable_https_alb && length(var.route53_zone_id) > 0 ? {
    for dvo in aws_acm_certificate.api[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  type            = each.value.type
  zone_id         = var.route53_zone_id
  records         = [each.value.record]
  ttl             = 60
}

resource "aws_acm_certificate_validation" "api" {
  count = var.enable_https_alb && var.create_alb_https_listener ? 1 : 0

  certificate_arn = aws_acm_certificate.api[0].arn
  # Works with Route53 records managed here or CNAMEs created at an external DNS host.
  validation_record_fqdns = [for dvo in aws_acm_certificate.api[0].domain_validation_options : dvo.resource_record_name]

  timeouts {
    create = "45m"
  }
}

# ---------------------------------------------------------------------------
# Listeners
# ---------------------------------------------------------------------------

resource "aws_lb_listener" "https" {
  count = var.enable_https_alb && var.create_alb_https_listener ? 1 : 0

  load_balancer_arn = aws_lb.api[0].arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = var.enable_https_alb ? 1 : 0

  load_balancer_arn = aws_lb.api[0].arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = var.alb_redirect_http_to_https ? "redirect" : "forward"

    dynamic "forward" {
      for_each = var.alb_redirect_http_to_https ? [] : [1]
      content {
        target_group {
          arn    = aws_lb_target_group.api[0].arn
          weight = 1
        }
      }
    }

    dynamic "redirect" {
      for_each = var.alb_redirect_http_to_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Optional Route53 alias (skip if using GoDaddy — add CNAME manually)
# ---------------------------------------------------------------------------

resource "aws_route53_record" "api_alias" {
  count = var.enable_https_alb && var.create_route53_alias_for_api && length(var.route53_zone_id) > 0 ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.api_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.api[0].dns_name
    zone_id                = aws_lb.api[0].zone_id
    evaluate_target_health = true
  }
}
