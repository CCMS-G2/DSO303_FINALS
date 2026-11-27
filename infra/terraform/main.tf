# CCMS on AWS. One module per concern; see the proposal's architecture (Section 13).
#
#   network -> ecr, database -> secrets -> messaging, cdn -> storage
#           -> ecs -> notification -> api -> frontend files -> monitoring

# First two Availability Zones in the region (ap-south-1a, ap-south-1b)
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  repo_root    = "${path.root}/../.."
  frontend_url = module.cdn.url
}

module "network" {
  source = "./modules/network"

  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  project                  = var.project
  vpc_cidr                 = var.vpc_cidr
  public_subnet_cidrs      = var.public_subnet_cidrs
  private_app_subnet_cidrs = var.private_app_subnet_cidrs
  private_db_subnet_cidrs  = var.private_db_subnet_cidrs
  alb_prod_port            = var.alb_prod_port
  service_ports            = var.service_ports
}

module "ecr" {
  source       = "./modules/ecr"
  project      = var.project
  repositories = ["auth-service", "complaint-service"]
}

module "database" {
  source                = "./modules/database"
  project               = var.project
  db_subnet_group_name  = module.network.db_subnet_group_name
  security_group_id     = module.network.security_group_ids.rds
  backup_retention_days = var.db_backup_retention_days
}

module "secrets" {
  source      = "./modules/secrets"
  project     = var.project
  db_host     = module.database.address
  db_port     = module.database.port
  db_name     = module.database.db_name
  db_username = module.database.username
  db_password = module.database.password
}

module "messaging" {
  source  = "./modules/messaging"
  project = var.project
}

module "cdn" {
  source  = "./modules/cdn"
  project = var.project
}

module "storage" {
  source          = "./modules/storage"
  project         = var.project
  allowed_origins = [local.frontend_url]
}

module "ecs" {
  source = "./modules/ecs"

  project                = var.project
  vpc_id                 = module.network.vpc_id
  private_app_subnet_ids = module.network.private_app_subnet_ids
  alb_security_group_id  = module.network.security_group_ids.alb
  ecs_security_group_id  = module.network.security_group_ids.ecs
  alb_port               = var.alb_prod_port

  image_urls = {
    auth      = module.ecr.repository_urls["auth-service"]
    complaint = module.ecr.repository_urls["complaint-service"]
  }
  image_tag = var.image_tag
  min_tasks = var.ecs_min_tasks
  max_tasks = var.ecs_max_tasks

  db_secret_arn        = module.secrets.db_secret_arn
  jwt_secret_arn       = module.secrets.jwt_secret_arn
  evidence_bucket_name = module.storage.bucket_name
  evidence_bucket_arn  = module.storage.bucket_arn
  queue_url            = module.messaging.queue_url
  queue_arn            = module.messaging.queue_arn
  init_sql_b64         = filebase64("${local.repo_root}/db/init.sql")
}

module "notification" {
  source = "./modules/notification"

  project                  = var.project
  source_dir               = "${local.repo_root}/services/notification-service"
  private_app_subnet_ids   = module.network.private_app_subnet_ids
  lambda_security_group_id = module.network.security_group_ids.lambda
  queue_arn                = module.messaging.queue_arn
  db_secret_arn            = module.secrets.db_secret_arn
  jwt_secret_arn           = module.secrets.jwt_secret_arn
  auth_service_url         = module.ecs.alb_url
  ses_sender_email         = var.ses_sender_email
  simulate_failure         = var.simulate_notification_failure
}

module "api" {
  source = "./modules/api"

  project                        = var.project
  private_app_subnet_ids         = module.network.private_app_subnet_ids
  vpclink_security_group_id      = module.network.security_group_ids.vpclink
  alb_listener_arn               = module.ecs.alb_listener_arn
  notification_api_invoke_arn    = module.notification.api_invoke_arn
  notification_api_function_name = module.notification.api_function_name
  cors_allowed_origins           = [local.frontend_url]
}

# ---------------------------------------------------------------------------
# Frontend files. config.js is generated here so the browser calls API Gateway.
# Cache-Control: no-cache makes CloudFront revalidate, so no invalidation is needed.
# ---------------------------------------------------------------------------
locals {
  frontend_files = {
    "index.html" = "text/html"
    "app.js"     = "text/javascript"
    "style.css"  = "text/css"
  }
}

resource "aws_s3_object" "frontend" {
  for_each      = local.frontend_files
  bucket        = module.cdn.bucket_name
  key           = each.key
  source        = "${local.repo_root}/frontend/${each.key}"
  etag          = filemd5("${local.repo_root}/frontend/${each.key}")
  content_type  = each.value
  cache_control = "no-cache"
}

resource "aws_s3_object" "frontend_config" {
  bucket        = module.cdn.bucket_name
  key           = "config.js"
  content       = "window.CCMS_CONFIG = ${jsonencode({ apiUrl = module.api.api_url })};\n"
  content_type  = "text/javascript"
  cache_control = "no-cache"
}

module "monitoring" {
  source = "./modules/monitoring"

  project                   = var.project
  alert_email               = var.alert_email
  api_id                    = module.api.api_id
  alb_arn_suffix            = module.ecs.alb_arn_suffix
  target_group_arn_suffixes = module.ecs.target_group_arn_suffixes
  ecs_cluster_name          = module.ecs.cluster_name
  ecs_service_names         = module.ecs.service_names
  queue_name                = module.messaging.queue_name
  dlq_name                  = module.messaging.dlq_name
  consumer_function_name    = module.notification.function_names["consumer"]
  db_instance_id            = module.database.instance_id
}

# ---------------------------------------------------------------------------
# CI/CD: a push to main that changes services/<name>/** rebuilds and deploys
# only that service. Approve the GitHub connection once in the console first.
# ---------------------------------------------------------------------------
module "cicd" {
  source = "./modules/cicd"
  count  = var.enable_cicd ? 1 : 0

  project            = var.project
  github_repository  = var.github_repository
  branch             = var.cicd_branch
  ecs_cluster_name   = module.ecs.cluster_name
  ecs_task_role_arns = module.ecs.iam_role_arns

  services = {
    for svc in ["auth", "complaint"] : "${svc}-service" => {
      repository_url   = module.ecr.repository_urls["${svc}-service"]
      container_name   = "${svc}-service"
      ecs_service_name = module.ecs.service_names[svc]
    }
  }
  ecr_repository_arns = module.ecr.repository_arns
}
