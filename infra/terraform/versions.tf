terraform {
  # 1.11+ is needed for S3 native state locking (use_lockfile), so no DynamoDB table is required.
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random" # database password and JWT secret
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive" # zips the notification Lambda package
      version = "~> 2.4"
    }
  }

  # Values (bucket, key, region) come from backend.hcl:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {}
}
