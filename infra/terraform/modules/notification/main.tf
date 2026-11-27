# Notification Service on AWS Lambda: one package, two functions.
#   consumer: SQS complaint-events -> store in-app notification -> SES email
#   api:      GET /api/notifications, PATCH /api/notifications/{id}/read
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  functions = {
    consumer = { handler = "src/lambda.consumer", timeout = var.consumer_timeout_seconds }
    api      = { handler = "src/lambda.api", timeout = 10 }
  }
}

# Run `npm ci --omit=dev` in the service folder first (scripts/aws-deploy.sh does this).
data "archive_file" "package" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.root}/.build/notification-lambda.zip"
  excludes    = ["Dockerfile", ".dockerignore", "package-lock.json"]
}

# ---------------------------------------------------------------------------
# IAM: one role per function (least privilege)
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.functions
  name               = "${var.project}-notification-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Logs + VPC network interfaces
resource "aws_iam_role_policy_attachment" "vpc_access" {
  for_each   = local.functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# X-Ray traces
resource "aws_iam_role_policy_attachment" "xray" {
  for_each   = local.functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "secrets" {
  for_each = local.functions
  name     = "read-ccms-secrets"
  role     = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = [var.db_secret_arn, var.jwt_secret_arn]
    }]
  })
}

resource "aws_iam_role_policy" "consumer" {
  name = "consume-events-send-email"
  role = aws_iam_role.fn["consumer"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ConsumeComplaintEvents"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
        Resource = var.queue_arn
      },
      {
        Sid      = "SendEmail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail"]
        Resource = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/*"
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.project}-notification-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each = local.functions

  function_name    = "${var.project}-notification-${each.key}"
  role             = aws_iam_role.fn[each.key].arn
  handler          = each.value.handler
  runtime          = "nodejs22.x"
  architectures    = ["arm64"] # pure-JS dependencies; Graviton is cheaper
  filename         = data.archive_file.package.output_path
  source_code_hash = data.archive_file.package.output_base64sha256
  timeout          = each.value.timeout
  memory_size      = 256

  vpc_config {
    subnet_ids         = var.private_app_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  tracing_config {
    mode = "Active" # AWS X-Ray
  }

  environment {
    variables = merge(
      {
        DB_SECRET_ARN    = var.db_secret_arn
        JWT_SECRET_ARN   = var.jwt_secret_arn
        AUTH_SERVICE_URL = var.auth_service_url
      },
      var.ses_sender_email != "" ? { SES_SENDER = var.ses_sender_email } : {},
      each.key == "consumer" ? { SIMULATE_FAILURE = tostring(var.simulate_failure) } : {},
    )
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.vpc_access]
}

resource "aws_lambda_event_source_mapping" "events" {
  event_source_arn                   = var.queue_arn
  function_name                      = aws_lambda_function.fn["consumer"].arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"] # retry only the failed messages

  scaling_config {
    maximum_concurrency = 5 # protects the small RDS instance from too many connections
  }

  depends_on = [aws_iam_role_policy.consumer]
}

# ---------------------------------------------------------------------------
# SES sender identity (optional). AWS emails a verification link to this
# address; click it before expecting email. In the SES sandbox, recipients
# must be verified too.
# ---------------------------------------------------------------------------
resource "aws_sesv2_email_identity" "sender" {
  count          = var.ses_sender_email != "" ? 1 : 0
  email_identity = var.ses_sender_email
}
