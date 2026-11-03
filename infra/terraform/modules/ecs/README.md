# ecs module

**Roadmap step 9.** Not built yet.

ECS Fargate cluster, internal ALB with path routing, task definitions and services for auth (3000) and complaint (3001) across two AZs, IAM task roles, `awslogs` log groups, and auto scaling from 2 to 4 tasks at 60% CPU.

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "ecs"`.
