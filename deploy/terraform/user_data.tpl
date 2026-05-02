#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/user-data.log | logger -t user-data -s 2>/dev/console) 2>&1

# IMDSv2 + region (SSM agent uses instance profile in this region).
TOKEN=$(curl -fsS --retry 8 --retry-delay 2 --retry-all-errors -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION="$REGION"

# SSM agent first: AL2023 ships curl-minimal — do not install full "curl" (dnf conflict). Only install the agent.
dnf install -y amazon-ssm-agent || true
systemctl enable amazon-ssm-agent || true
systemctl start amazon-ssm-agent || true
for _ in $(seq 1 45); do
  if curl -sS --max-time 3 -o /dev/null "https://ssm.$${REGION}.amazonaws.com/"; then
    break
  fi
  sleep 2
done
systemctl restart amazon-ssm-agent || true

dnf install -y docker awscli
if ! dnf install -y docker-compose-plugin; then
  COMPOSE_VER="$${DOCKER_COMPOSE_VERSION:-2.24.7}"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) CARCH=x86_64 ;;
    aarch64) CARCH=aarch64 ;;
    *) echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/v$${COMPOSE_VER}/docker-compose-linux-$${CARCH}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
systemctl enable --now docker

mkdir -p '${deploy_directory}'
chmod 700 '${deploy_directory}'

# ec2-user / ssm-user may run docker depending on AMI; add common users to docker group.
for u in ec2-user ssm-user; do
  if id "$u" &>/dev/null; then
    usermod -aG docker "$u" || true
  fi
done

systemctl restart amazon-ssm-agent || true

echo "Bootstrap complete. Copy docker-compose.prod.yml and .env to ${deploy_directory} then deploy via GitHub Actions."
