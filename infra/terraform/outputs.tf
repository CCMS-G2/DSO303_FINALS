# ---- What you open in the browser ----
output "frontend_url" {
  description = "Open this in the browser."
  value       = module.cdn.url
}

output "api_url" {
  value = module.api.api_url
}

# ---- Used by scripts/aws-*.sh ----
output "ecr_repository_urls" {
  value = module.ecr.repository_urls
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_service_names" {
  value = module.ecs.service_names
}

output "migrate_task_family" {
  value = module.ecs.migrate_task_family
}

output "private_app_subnet_ids" {
  value = module.network.private_app_subnet_ids
}

output "ecs_security_group_id" {
  value = module.network.security_group_ids.ecs
}

output "notification_functions" {
  value = module.notification.function_names
}

output "dlq_url" {
  value = module.messaging.dlq_url
}

output "dashboard_name" {
  value = module.monitoring.dashboard_name
}

# ---- Network (from step 1) ----
output "vpc_id" {
  value = module.network.vpc_id
}

output "availability_zones" {
  value = module.network.availability_zones
}

output "nat_gateway_public_ip" {
  value = module.network.nat_gateway_public_ip
}

# ---- CI/CD ----
output "github_connection_status" {
  description = "PENDING until approved in the console: Developer Tools > Settings > Connections."
  value       = var.enable_cicd ? module.cicd[0].connection_status : "disabled"
}

output "pipeline_names" {
  value = var.enable_cicd ? module.cicd[0].pipeline_names : {}
}
