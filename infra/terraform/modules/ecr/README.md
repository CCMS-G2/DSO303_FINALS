# ecr module

**Roadmap step 5.** Not built yet.

Amazon ECR repositories for `auth-service` and `complaint-service`, with scan-on-push and a lifecycle rule that keeps the last 10 images.

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "ecr"`.
