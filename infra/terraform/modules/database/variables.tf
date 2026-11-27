variable "project" {
  type = string
}

variable "db_subnet_group_name" {
  type = string
}

variable "security_group_id" {
  description = "sg-rds: allows 5432 from ECS tasks and Lambda only."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major version; AWS picks the current minor."
  type        = string
  default     = "16"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_name" {
  type    = string
  default = "ccms"
}

variable "username" {
  type    = string
  default = "ccms_admin"
}

variable "backup_retention_days" {
  description = "Automated backup retention. Proposal says 7; Free plan accounts may only allow 1."
  type        = number
  default     = 1
}
