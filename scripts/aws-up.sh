#!/usr/bin/env bash
# Deploy CCMS to your own AWS account (see README: "Deploying to your own AWS account").
#
#   1. create the ECR repositories
#   2. build and push the two service images (tagged :<git sha> and :latest)
#   3. terraform apply (shows the plan and asks before creating anything)
#   4. load db/init.sql into RDS with a one-off ECS task (first run only)
#   5. roll the ECS services onto the new images and wait until healthy
#
# Usage: scripts/aws-up.sh                 asks before terraform apply
#        AUTO_APPROVE=1 scripts/aws-up.sh  no prompt (unattended runs)
# Re-running it is safe; it redeploys.
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_PROFILE="${AWS_PROFILE_NAME:-ccms}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
TF="terraform -chdir=infra/terraform"
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v terraform >/dev/null || die "terraform is not installed"
docker info >/dev/null 2>&1    || die "Docker is not running (start Docker Desktop first)"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text) || die "AWS profile '$AWS_PROFILE' does not work"
echo "Deploying to account $ACCOUNT as profile $AWS_PROFILE in $AWS_REGION"

(cd services/notification-service && npm ci --omit=dev --silent)  # Lambda package contents

step "1/5 ECR repositories"
$TF apply -target=module.ecr -auto-approve -input=false >/dev/null
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

step "2/5 Build and push images"
TAG=$(git rev-parse --short HEAD)
for svc in auth-service complaint-service; do
  repo="$REGISTRY/ccms/$svc"
  docker build --platform linux/amd64 -t "$repo:$TAG" -t "$repo:latest" "services/$svc"
  docker push --quiet "$repo:$TAG"
  docker push --quiet "$repo:latest"
done

step "3/5 Terraform apply"
$TF apply -input=false ${AUTO_APPROVE:+-auto-approve}

CLUSTER=$($TF output -raw ecs_cluster_name)
step "4/5 Database schema"
FAMILY=$($TF output -raw migrate_task_family)
SUBNETS=$($TF output -json private_app_subnet_ids | tr -d '[]" \n')
SG=$($TF output -raw ecs_security_group_id)
TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$FAMILY" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "migration task started, waiting..."
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$CODE" = "0" ]; then
  echo "schema and seed data loaded"
elif aws logs tail /ccms/migrate --since 15m 2>/dev/null | grep -q 'already exists'; then
  echo "schema already present (not the first deploy), skipped"
else
  aws logs tail /ccms/migrate --since 15m || true
  die "migration failed (exit code $CODE); see the log above"
fi

step "5/5 Roll out services"
for svc in auth-service complaint-service; do
  aws ecs update-service --cluster "$CLUSTER" --service "$svc" --force-new-deployment --query 'service.serviceName' --output text
done
echo "waiting for both services to become stable (a few minutes)..."
aws ecs wait services-stable --cluster "$CLUSTER" --services auth-service complaint-service

step "Done"
echo "Frontend:  $($TF output -raw frontend_url)"
echo "API:       $($TF output -raw api_url)"
echo "Dashboard: https://$AWS_REGION.console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#dashboards/dashboard/$($TF output -raw dashboard_name)"
echo
echo "When you are finished: scripts/aws-down.sh"
