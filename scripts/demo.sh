#!/usr/bin/env bash
# Helpers for recording the CCMS demo (proposal, "Planned Demonstration Scenarios").
#
#   scripts/demo.sh urls          print every URL you need on screen
#   scripts/demo.sh status        ECS task counts, queue depths, alarm states
#   scripts/demo.sh e2e           scenarios 1-2: full lifecycle through the API
#   scripts/demo.sh kill-task     scenario 4: stop one auth-service task, watch ECS replace it
#   scripts/demo.sh load          scenario 5: k6 load test, ECS scales 2 -> 4 tasks
#   scripts/demo.sh break-lambda  scenario 6: notification consumer starts failing
#   scripts/demo.sh fix-lambda    scenario 6: restore it (and redrive the DLQ)
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_PROFILE="${AWS_PROFILE_NAME:-ccms}" AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER=""
TF="terraform -chdir=infra/terraform"
out() { $TF output -raw "$1"; }
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

CLUSTER=$(out ecs_cluster_name)
queue_url() { aws sqs get-queue-url --queue-name "$1" --query QueueUrl --output text; }

case "${1:-}" in
urls)
  R=$AWS_REGION; C="https://$R.console.aws.amazon.com"
  cat <<EOF
App (CloudFront):   $(out frontend_url)
API Gateway:        $(out api_url)            (root path returns "Not Found"; routes live under /api/...)
Dashboard:          $C/cloudwatch/home?region=$R#dashboards/dashboard/$(out dashboard_name)
Alarms:             $C/cloudwatch/home?region=$R#alarmsV2:
ECS cluster:        $C/ecs/v2/clusters/$CLUSTER/services?region=$R
Pipelines:          $C/codesuite/codepipeline/pipelines?region=$R
SQS queues:         $C/sqs/v3/home?region=$R#/queues
Lambda:             $C/lambda/home?region=$R#/functions
RDS:                $C/rds/home?region=$R#databases:
ECR:                $C/ecr/private-registry/repositories?region=$R
S3 buckets:         $C/s3/buckets?region=$R
Logs Insights:      $C/cloudwatch/home?region=$R#logsV2:logs-insights
CloudTrail:         $C/cloudtrail/home?region=$R#/events
EOF
  ;;
status)
  say "ECS services (desired / running)"
  aws ecs describe-services --cluster "$CLUSTER" --services auth-service complaint-service \
    --query 'services[].[serviceName,desiredCount,runningCount]' --output table
  say "Queues"
  for q in ccms-complaint-events ccms-complaint-events-dlq; do
    printf '%-28s %s\n' "$q" "$(aws sqs get-queue-attributes --queue-url "$(queue_url $q)" \
      --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages --output text)"
  done
  say "Alarms"
  aws cloudwatch describe-alarms --alarm-name-prefix ccms- --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
  ;;
e2e) scripts/demo-e2e.sh ;;
kill-task)
  TASK=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name auth-service --query 'taskArns[0]' --output text)
  say "Stopping $TASK"
  aws ecs stop-task --cluster "$CLUSTER" --task "$TASK" --reason "Demo scenario 4: failure test" --query 'task.lastStatus' --output text
  API=$(out api_url)
  say "Hitting /api/auth/login every 2 s while ECS replaces the task (Ctrl+C to stop)"
  while true; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
      -d '{"email":"student@ccms.edu","password":"Password123!"}')
    run=$(aws ecs describe-services --cluster "$CLUSTER" --services auth-service --query 'services[0].runningCount' --output text)
    printf '%s  login=%s  running auth tasks=%s\n' "$(date +%T)" "$code" "$run"
    sleep 2
  done
  ;;
load)
  say "k6 load test (about 6.5 min). Watch the dashboard 'ECS running tasks' widget."
  k6 run -e API="$(out api_url)" tests/load/k6-load.js
  say "Task counts now"
  aws ecs describe-services --cluster "$CLUSTER" --services auth-service complaint-service \
    --query 'services[].[serviceName,desiredCount,runningCount]' --output table
  ;;
break-lambda)
  say "Deploying the consumer with SIMULATE_FAILURE=true"
  $TF apply -target=module.notification -var simulate_notification_failure=true -auto-approve -input=false >/dev/null
  say "Now submit a complaint in the app (or run: scripts/demo.sh e2e)."
  echo "Each event is retried 3 times (180 s visibility timeout), then moves to the DLQ in ~9-10 minutes."
  echo "Then the ccms-dlq-not-empty alarm fires and emails the team. Check with: scripts/demo.sh status"
  ;;
fix-lambda)
  say "Restoring the consumer"
  $TF apply -target=module.notification -var simulate_notification_failure=false -auto-approve -input=false >/dev/null
  DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$(queue_url ccms-complaint-events-dlq)" \
    --attribute-names QueueArn --query Attributes.QueueArn --output text)
  say "Redriving dead-letter messages back to the main queue"
  aws sqs start-message-move-task --source-arn "$DLQ_ARN" --query TaskHandle --output text || true
  ;;
*) sed -n '2,11p' "$0"; exit 1 ;;
esac
