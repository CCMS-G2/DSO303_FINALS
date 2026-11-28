variable "project" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_app_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "ecs_security_group_id" {
  type = string
}

variable "alb_port" {
  type    = number
  default = 80
}

variable "image_urls" {
  description = "ECR repository URL per service (auth, complaint)."
  type        = map(string)
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "task_cpu" {
  type    = number
  default = 256 # 0.25 vCPU
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "min_tasks" {
  type    = number
  default = 2
}

variable "max_tasks" {
  type    = number
  default = 4
}

variable "db_secret_arn" {
  type = string
}

variable "jwt_secret_arn" {
  type = string
}

variable "evidence_bucket_name" {
  type = string
}

variable "evidence_bucket_arn" {
  type = string
}

variable "queue_url" {
  type = string
}

variable "queue_arn" {
  type = string
}

variable "init_sql_b64" {
  description = "db/init.sql, base64-encoded, for the migration task."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 14
}
