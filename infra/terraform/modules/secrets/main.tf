# AWS Secrets Manager: database connection details and the JWT signing secret.
# ECS injects these into containers at start-up; the Lambdas read them at cold start.
# Nothing secret is stored in Git or in task definitions.

resource "random_password" "jwt" {
  length  = 64
  special = false
}

locals {
  db_base = "postgresql://${var.db_username}:${var.db_password}@${var.db_host}:${var.db_port}/${var.db_name}"
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.project}/database"
  description             = "CCMS RDS connection details"
  recovery_window_in_days = 0 # delete immediately on destroy, so the next apply can reuse the name
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    # Node (pg): TLS on, server certificate not verified (RDS CA is not in Node's trust store).
    url = "${local.db_base}?sslmode=no-verify"
    # psql (migration task): TLS required.
    psql_url = "${local.db_base}?sslmode=require"
    host     = var.db_host
    port     = var.db_port
    dbname   = var.db_name
    username = var.db_username
    password = var.db_password
  })
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.project}/jwt-secret"
  description             = "CCMS JWT signing secret (HS256)"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}
