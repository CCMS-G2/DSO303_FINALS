variable "project" {
  description = "Name prefix for every resource"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Two Availability Zones (index 0 = AZ-a, index 1 = AZ-b)"
  type        = list(string)

  validation {
    condition     = length(var.azs) == 2
    error_message = "Exactly two Availability Zones are required."
  }
}

variable "public_subnet_cidrs" {
  description = "Public subnets, one per AZ (NAT Gateway lives in the first one)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_app_subnet_cidrs" {
  description = "Private app subnets: ECS tasks, internal ALB, VPC Link, Lambda"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "private_db_subnet_cidrs" {
  description = "Private DB subnets: RDS DB subnet group (no internet route)"
  type        = list(string)
  default     = ["10.0.21.0/24", "10.0.22.0/24"]
}

variable "alb_prod_port" {
  description = "ALB production listener port (VPC Link sends user traffic here)"
  type        = number
  default     = 80
}

variable "service_ports" {
  description = "Container ports of the ECS services"
  type        = map(number)
  default = {
    auth      = 3000
    complaint = 3001
  }
}
