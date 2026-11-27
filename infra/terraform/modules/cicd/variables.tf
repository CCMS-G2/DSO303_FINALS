variable "project" {
  type = string
}

variable "github_repository" {
  description = "owner/repo on GitHub."
  type        = string
}

variable "branch" {
  type    = string
  default = "main"
}

variable "services" {
  description = "Per service folder name: its ECR repository, container name and ECS service."
  type = map(object({
    repository_url   = string
    container_name   = string
    ecs_service_name = string
  }))
}

variable "ecr_repository_arns" {
  type = map(string)
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_task_role_arns" {
  description = "Execution and task roles the ECS deploy action passes to new task definitions."
  type        = list(string)
}
