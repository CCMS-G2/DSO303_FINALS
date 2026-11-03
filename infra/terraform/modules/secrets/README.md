# secrets module

**Roadmap step 7.** Not built yet.

AWS Secrets Manager entries for the database credentials and `JWT_SECRET`, injected into ECS tasks at start-up.

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "secrets"`.
