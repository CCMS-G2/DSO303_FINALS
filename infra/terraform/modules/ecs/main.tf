# ECS on Fargate: cluster, internal ALB, the Auth and Complaint services,
# auto scaling, and a one-off database migration task.
data "aws_region" "current" {}

locals {
  region  = data.aws_region.current.region
  alb_url = "http://${aws_lb.internal.dns_name}"
  services = {
    auth = {
      port     = 3000
      priority = 10
      paths    = ["/api/auth/*", "/api/users", "/api/users/*", "/internal/users/*"]
      env      = {}
    }
    complaint = {
      port     = 3001
      priority = 20
      paths    = ["/api/complaints", "/api/complaints/*", "/api/categories", "/api/locations", "/api/stats/*"]
      env = {
        AUTH_SERVICE_URL           = local.alb_url # service-to-service call through the internal ALB
        EVIDENCE_BUCKET            = var.evidence_bucket_name
        COMPLAINT_EVENTS_QUEUE_URL = var.queue_url
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Cluster and logs
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = "${var.project}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled" # CPU/memory per task and service in CloudWatch
  }
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = local.services
  name              = "/${var.project}/${each.key}-service"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/${var.project}/migrate"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# Internal Application Load Balancer with path-based routing
# ---------------------------------------------------------------------------
resource "aws_lb" "internal" {
  name                       = "${var.project}-internal-alb"
  internal                   = true # reachable only through the VPC Link and from inside the VPC
  load_balancer_type         = "application"
  security_groups            = [var.alb_security_group_id]
  subnets                    = var.private_app_subnet_ids
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "service" {
  for_each = local.services

  name                 = "${var.project}-${each.key}-tg"
  port                 = each.value.port
  protocol             = "HTTP"
  target_type          = "ip" # required for Fargate (awsvpc networking)
  vpc_id               = var.vpc_id
  deregistration_delay = 30 # faster rolling deployments

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.internal.arn
  port              = var.alb_port
  protocol          = "HTTP" # TLS terminates at API Gateway (proposal, accepted trade-off)

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"Not found\"}"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "service" {
  for_each     = local.services
  listener_arn = aws_lb_listener.http.arn
  priority     = each.value.priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }

  condition {
    path_pattern {
      values = each.value.paths
    }
  }
}

# ---------------------------------------------------------------------------
# IAM: one execution role (pull images, write logs, read secrets) and one
# task role per service with least privilege.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.project}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-ccms-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = [var.db_secret_arn, var.jwt_secret_arn]
    }]
  })
}

resource "aws_iam_role" "task" {
  for_each           = local.services
  name               = "${var.project}-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# Auth Service needs no AWS API access, so its task role has no policies.
# Complaint Service: evidence objects and the complaint-events queue only.
resource "aws_iam_role_policy" "complaint_task" {
  name = "evidence-and-events"
  role = aws_iam_role.task["complaint"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EvidenceObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${var.evidence_bucket_arn}/uploads/*"
      },
      {
        Sid      = "PublishComplaintEvents"
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = var.queue_arn
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Task definitions and services
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "service" {
  for_each = local.services

  family                   = "${var.project}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.key].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name         = "${each.key}-service"
    image        = "${var.image_urls[each.key]}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = each.value.port, protocol = "tcp" }]

    environment = [for k, v in merge({
      PORT       = tostring(each.value.port)
      NODE_ENV   = "production"
      AWS_REGION = local.region
    }, each.value.env) : { name = k, value = v }]

    # Injected from Secrets Manager at start-up; never visible in the task definition.
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${var.db_secret_arn}:url::" },
      { name = "JWT_SECRET", valueFrom = var.jwt_secret_arn },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
        awslogs-region        = local.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_ecs_service" "service" {
  for_each = local.services

  name            = "${each.key}-service"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = var.min_tasks
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_app_subnet_ids # spread across both AZs
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.service[each.key].arn
    container_name   = "${each.key}-service"
    container_port   = each.value.port
  }

  # Rolling update keeping 100% capacity; roll back automatically if new tasks fail health checks.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  health_check_grace_period_seconds = 30

  depends_on = [aws_lb_listener_rule.service, aws_iam_role_policy_attachment.execution_managed]

  lifecycle {
    ignore_changes = [desired_count] # owned by auto scaling after creation
  }
}

# ---------------------------------------------------------------------------
# Auto scaling: 2 to 4 tasks, target 60% average CPU (proposal, NFR-02)
# ---------------------------------------------------------------------------
resource "aws_appautoscaling_target" "service" {
  for_each           = local.services
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.service[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_tasks
  max_capacity       = var.max_tasks
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.services
  name               = "${var.project}-${each.key}-cpu60"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_out_cooldown = 30
    scale_in_cooldown  = 120
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# ---------------------------------------------------------------------------
# Migration task: loads db/init.sql into RDS once, from inside the VPC.
# Run it with scripts/aws-migrate.sh (aws ecs run-task).
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.project}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn

  container_definitions = jsonencode([{
    name        = "migrate"
    image       = "public.ecr.aws/docker/library/postgres:16-alpine"
    essential   = true
    command     = ["sh", "-c", "echo \"$INIT_SQL_B64\" | base64 -d | psql \"$PSQL_URL\" -v ON_ERROR_STOP=1"]
    environment = [{ name = "INIT_SQL_B64", value = var.init_sql_b64 }]
    secrets     = [{ name = "PSQL_URL", valueFrom = "${var.db_secret_arn}:psql_url::" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migrate.name
        awslogs-region        = local.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}
