# storage module

**Roadmap step 8.** Not built yet.

Private S3 evidence bucket (pre-signed uploads, `state=pending` lifecycle rule, Block Public Access) and the S3 bucket that holds the built frontend.

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "storage"`.
