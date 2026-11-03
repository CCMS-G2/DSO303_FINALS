# messaging module

**Roadmap step 10.** Not built yet.

SQS `complaint-events` queue with a dead-letter queue (3 receives, visibility timeout 180 s).

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "messaging"`.
