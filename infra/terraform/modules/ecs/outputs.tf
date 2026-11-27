output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_names" {
  value = { for k, s in aws_ecs_service.service : k => s.name }
}

output "alb_dns_name" {
  value = aws_lb.internal.dns_name
}

output "alb_url" {
  value = local.alb_url
}

output "alb_listener_arn" {
  value = aws_lb_listener.http.arn
}

output "alb_arn_suffix" {
  value = aws_lb.internal.arn_suffix
}

output "target_group_arn_suffixes" {
  value = { for k, tg in aws_lb_target_group.service : k => tg.arn_suffix }
}

output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "log_group_names" {
  value = { for k, g in aws_cloudwatch_log_group.service : k => g.name }
}
