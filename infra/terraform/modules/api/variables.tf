variable "project" {
  type = string
}

variable "private_app_subnet_ids" {
  type = list(string)
}

variable "vpclink_security_group_id" {
  type = string
}

variable "alb_listener_arn" {
  type = string
}

variable "notification_api_invoke_arn" {
  type = string
}

variable "notification_api_function_name" {
  type = string
}

variable "cors_allowed_origins" {
  type = list(string)
}

variable "throttle_burst" {
  type    = number
  default = 100
}

variable "throttle_rate" {
  type    = number
  default = 50
}

variable "log_retention_days" {
  type    = number
  default = 14
}
