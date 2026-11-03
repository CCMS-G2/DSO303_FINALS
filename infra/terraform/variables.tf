variable "aws_region" {
  description = "AWS region for all CCMS resources (Mumbai, nearest to campus)."
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "AWS CLI profile Terraform uses. Pinned so a shell AWS_PROFILE (e.g. the floci emulator) is ignored."
  type        = string
  default     = "ccms"
}

variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "ccms"
}

variable "vpc_cidr" {
  description = "VPC CIDR from the proposal network layout."
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnets, AZ-a then AZ-b (NAT Gateway lives in AZ-a)."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_app_subnet_cidrs" {
  description = "Private app subnets, AZ-a then AZ-b (ECS tasks, internal ALB, VPC Link, Lambda)."
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "private_db_subnet_cidrs" {
  description = "Private DB subnets, AZ-a then AZ-b (RDS subnet group)."
  type        = list(string)
  default     = ["10.0.21.0/24", "10.0.22.0/24"]
}

variable "alb_prod_port" {
  description = "Internal ALB production listener port (proposal: 80). API Gateway VPC Link sends user traffic here."
  type        = number
  default     = 80
}

variable "service_ports" {
  description = "Container ports for the ECS services."
  type        = map(number)
  default = {
    auth      = 3000
    complaint = 3001
  }
}
