variable "project" {
  type = string
}

variable "alert_email" {
  description = "Where alarm and budget emails go. Empty = alarms still exist but nobody is emailed."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 20
}

variable "api_id" {
  type = string
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffixes" {
  type = map(string)
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_names" {
  type = map(string)
}

variable "queue_name" {
  type = string
}

variable "dlq_name" {
  type = string
}

variable "consumer_function_name" {
  type = string
}

variable "db_instance_id" {
  type = string
}
