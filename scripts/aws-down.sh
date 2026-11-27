#!/usr/bin/env bash
# Remove everything CCMS created in your AWS account (keeps only the Terraform state bucket).
# Terraform shows what will be destroyed and asks before doing it.
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE="${AWS_PROFILE_NAME:-ccms}"

(cd services/notification-service && [ -d node_modules ] || npm ci --omit=dev --silent)
terraform -chdir=infra/terraform destroy -input=false

echo
echo "Destroyed. Lambda network interfaces can take up to ~20 minutes to release;"
echo "if destroy timed out on a security group or subnet, just run this script again."
