# Amazon API Gateway (HTTP API): the single public entry point for all APIs.
#   /api/notifications...  -> notification Lambda
#   /api/*  (everything else) -> VPC Link -> internal ALB -> ECS services
# /internal/* is never routed, so internal APIs stay inside the VPC.

resource "aws_apigatewayv2_vpc_link" "this" {
  name               = "${var.project}-vpc-link"
  subnet_ids         = var.private_app_subnet_ids
  security_group_ids = [var.vpclink_security_group_id]
}

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_allowed_origins # the CloudFront frontend only
    allow_methods = ["GET", "POST", "PATCH", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "alb" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  integration_uri        = var.alb_listener_arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.this.id
  payload_format_version = "1.0"
  timeout_milliseconds   = 29000

  # Pass the API Gateway request ID through, so one request can be traced
  # across services in CloudWatch Logs Insights.
  request_parameters = {
    "overwrite:header.x-request-id" = "$context.requestId"
  }
}

resource "aws_apigatewayv2_integration" "notifications" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.notification_api_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "services" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "ANY /api/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.alb.id}"
}

resource "aws_apigatewayv2_route" "notifications_list" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "GET /api/notifications"
  target    = "integrations/${aws_apigatewayv2_integration.notifications.id}"
}

resource "aws_apigatewayv2_route" "notifications_read" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "PATCH /api/notifications/{id}/read"
  target    = "integrations/${aws_apigatewayv2_integration.notifications.id}"
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.notification_api_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/api/notifications*"
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/${var.project}/api-gateway"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttle_burst
    throttling_rate_limit  = var.throttle_rate
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      method             = "$context.httpMethod"
      path               = "$context.path"
      routeKey           = "$context.routeKey"
      status             = "$context.status"
      latencyMs          = "$context.responseLatency"
      integrationStatus  = "$context.integrationStatus"
      integrationLatency = "$context.integrationLatency"
      error              = "$context.integrationErrorMessage"
    })
  }
}
