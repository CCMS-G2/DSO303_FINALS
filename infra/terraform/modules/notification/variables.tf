variable "project" {
  type = string
}

variable "source_dir" {
  description = "Path to services/notification-service (with production node_modules installed)."
  type        = string
}

variable "private_app_subnet_ids" {
  type = list(string)
}

variable "lambda_security_group_id" {
  type = string
}

variable "queue_arn" {
  type = string
}

variable "db_secret_arn" {
  type = string
}

variable "jwt_secret_arn" {
  type = string
}

variable "auth_service_url" {
  description = "Internal ALB URL, for recipient email lookups."
  type        = string
}

variable "ses_sender_email" {
  description = "Verified SES sender address. Empty = in-app notifications only, no email."
  type        = string
  default     = ""
}

variable "simulate_failure" {
  description = "Demo scenario 6: make the consumer fail every message so they land in the DLQ."
  type        = bool
  default     = false
}

variable "consumer_timeout_seconds" {
  description = "Must be at most 1/6 of the queue visibility timeout."
  type        = number
  default     = 30
}

variable "log_retention_days" {
  type    = number
  default = 14
}
