# CloudWatch dashboard, alarms (proposal, Section 17), SNS alert topic and a budget.
data "aws_region" "current" {}

locals {
  region        = data.aws_region.current.region
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"
}

# AWS sends a confirmation email; the subscription is active once it is clicked.
resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.project}-api-5xx"
  alarm_description   = "API Gateway returned 5 or more server errors in 5 minutes"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_targets" {
  for_each            = var.target_group_arn_suffixes
  alarm_name          = "${var.project}-${each.key}-unhealthy-targets"
  alarm_description   = "At least one unhealthy ${each.key} task behind the ALB for 5 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { TargetGroup = each.value, LoadBalancer = var.alb_arn_suffix }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  for_each            = var.ecs_service_names
  alarm_name          = "${var.project}-${each.key}-cpu-high"
  alarm_description   = "${each.key} average CPU above 80% for 10 minutes (auto scaling reacts at 60%)"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = var.ecs_cluster_name, ServiceName = each.value }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${var.project}-dlq-not-empty"
  alarm_description   = "A complaint event failed 3 times and is in the dead-letter queue"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = var.dlq_name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "event_backlog" {
  alarm_name          = "${var.project}-event-backlog"
  alarm_description   = "Oldest complaint event has waited more than 5 minutes"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = var.queue_name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.project}-notification-errors"
  alarm_description   = "Notification consumer had 3 or more errors in 5 minutes"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = var.consumer_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.project}-rds-cpu-high"
  alarm_description   = "RDS CPU above 80% for 10 minutes"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = var.db_instance_id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${var.project}-rds-storage-low"
  alarm_description   = "RDS free storage below 2 GB"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = var.db_instance_id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2147483648
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# ---------------------------------------------------------------------------
# Dashboard: CCMS-Overview (used live in the final demo)
# ---------------------------------------------------------------------------
locals {
  svc = var.ecs_service_names
  widget = {
    api = {
      title = "API Gateway: requests and errors"
      metrics = [
        ["AWS/ApiGateway", "Count", "ApiId", var.api_id, { stat = "Sum" }],
        [".", "4xx", ".", ".", { stat = "Sum" }],
        [".", "5xx", ".", ".", { stat = "Sum" }],
      ]
    }
    latency = {
      title   = "API Gateway: latency (p95, ms)"
      metrics = [["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = "p95" }]]
    }
    ecs_cpu = {
      title   = "ECS: average CPU %"
      metrics = [for k, s in local.svc : ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", s, { label = k }]]
    }
    ecs_tasks = {
      title   = "ECS: running tasks (Container Insights)"
      metrics = [for k, s in local.svc : ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.ecs_cluster_name, "ServiceName", s, { label = k, stat = "Maximum" }]]
    }
    alb = {
      title   = "ALB: healthy targets"
      metrics = [for k, tg in var.target_group_arn_suffixes : ["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", tg, "LoadBalancer", var.alb_arn_suffix, { label = k, stat = "Minimum" }]]
    }
    queue = {
      title = "SQS: queue depth and DLQ"
      metrics = [
        ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.queue_name, { label = "events waiting", stat = "Maximum" }],
        [".", ".", ".", var.dlq_name, { label = "dead-letter queue", stat = "Maximum" }],
      ]
    }
    lambda = {
      title = "Notification Lambda: invocations and errors"
      metrics = [
        ["AWS/Lambda", "Invocations", "FunctionName", var.consumer_function_name, { stat = "Sum" }],
        [".", "Errors", ".", ".", { stat = "Sum" }],
        [".", "Throttles", ".", ".", { stat = "Sum" }],
      ]
    }
    rds = {
      title = "RDS: CPU % and connections"
      metrics = [
        ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_id],
        [".", "DatabaseConnections", ".", ".", { yAxis = "right" }],
      ]
    }
    business = {
      title   = "Business: notifications sent"
      metrics = [["CCMS", "NotificationsSent", { stat = "Sum" }]]
    }
  }
  widget_order = ["api", "latency", "ecs_cpu", "ecs_tasks", "alb", "queue", "lambda", "rds", "business"]
}

resource "aws_cloudwatch_dashboard" "overview" {
  dashboard_name = "${upper(var.project)}-Overview"
  dashboard_body = jsonencode({
    widgets = [for i, name in local.widget_order : {
      type   = "metric"
      x      = (i % 3) * 8
      y      = floor(i / 3) * 6
      width  = 8
      height = 6
      properties = {
        title   = local.widget[name].title
        metrics = local.widget[name].metrics
        region  = local.region
        view    = "timeSeries"
        stacked = false
        period  = 60
      }
    }]
  })
}

# ---------------------------------------------------------------------------
# Cost guard (optional): monthly budget with an email at 80% forecast
# ---------------------------------------------------------------------------
resource "aws_budgets_budget" "monthly" {
  count        = var.alert_email != "" ? 1 : 0
  name         = "${var.project}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
