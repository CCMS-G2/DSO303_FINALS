# ---------------------------------------------------------------------------
# Security group chain (proposal, "Security Group Chain" table)
#
#   API Gateway VPC Link (sg-vpclink) --80--> internal ALB (sg-alb)
#   internal ALB (sg-alb) --3000/3001--> ECS tasks (sg-ecs)
#   ECS tasks + Lambda --5432--> RDS (sg-rds)
#
# Rules are separate resources (aws_vpc_security_group_*_rule) so that
# sg-alb and sg-ecs can reference each other without a dependency cycle.
# ---------------------------------------------------------------------------

resource "aws_security_group" "vpclink" {
  name        = "${var.project}-sg-vpclink"
  description = "API Gateway VPC Link ENIs - outbound to the ALB only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.project}-sg-vpclink" }
}

resource "aws_security_group" "alb" {
  name        = "${var.project}-sg-alb"
  description = "Internal ALB - from VPC Link and ECS only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.project}-sg-alb" }
}

resource "aws_security_group" "ecs" {
  name        = "${var.project}-sg-ecs"
  description = "ECS Fargate tasks - from the ALB on the service ports only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.project}-sg-ecs" }
}

resource "aws_security_group" "lambda" {
  name        = "${var.project}-sg-lambda"
  description = "Notification Lambdas (SQS consumer + API) - no inbound"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.project}-sg-lambda" }
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-sg-rds"
  description = "RDS PostgreSQL - 5432 from ECS and Lambda only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.project}-sg-rds" }
}

# ----- sg-vpclink -----------------------------------------------------------
resource "aws_vpc_security_group_egress_rule" "vpclink_to_alb" {
  security_group_id            = aws_security_group.vpclink.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.alb_prod_port
  to_port                      = var.alb_prod_port
  description                  = "To ALB production listener"
}

# ----- sg-alb ---------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "alb_from_vpclink" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.vpclink.id
  ip_protocol                  = "tcp"
  from_port                    = var.alb_prod_port
  to_port                      = var.alb_prod_port
  description                  = "User traffic from API Gateway VPC Link"
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_ecs" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.ecs.id
  ip_protocol                  = "tcp"
  from_port                    = var.alb_prod_port
  to_port                      = var.alb_prod_port
  description                  = "Internal service calls from complaint to auth"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_ecs" {
  for_each                     = var.service_ports
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.ecs.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  description                  = "To ${each.key} service tasks"
}

# ----- sg-ecs ---------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  for_each                     = var.service_ports
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  description                  = "${each.key} service from ALB"
}

resource "aws_vpc_security_group_egress_rule" "ecs_https_out" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to ECR, SQS, Secrets Manager, CloudWatch, S3 (via NAT / endpoint)"
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_alb" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.alb_prod_port
  to_port                      = var.alb_prod_port
  description                  = "Internal service calls through the ALB"
}

resource "aws_vpc_security_group_egress_rule" "ecs_to_rds" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL"
}

# ----- sg-lambda ------------------------------------------------------------
resource "aws_vpc_security_group_egress_rule" "lambda_https_out" {
  security_group_id = aws_security_group.lambda.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to SQS, SES, Secrets Manager, CloudWatch"
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_rds" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL"
}

# ----- sg-rds ---------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.ecs.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "From ECS tasks"
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_lambda" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "From notification Lambda"
}
# sg-rds has no egress rule: the database never starts outbound connections.
