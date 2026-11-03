terraform {
  # 1.11+ is needed for S3 native state locking (use_lockfile), so no DynamoDB table is required.
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Values (bucket, key, region) come from backend.hcl:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {}
}
