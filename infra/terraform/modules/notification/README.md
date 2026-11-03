# notification module

**Roadmap step 12.** Not built yet.

Notification Lambdas (SQS consumer and `/api/notifications` handler) in the private app subnets with `sg-lambda`, plus the SES sender identity.

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "notification"`.
