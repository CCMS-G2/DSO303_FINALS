provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  # Every resource gets these tags, so you can find (and cost) everything CCMS created.
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Module    = "DSO303"
    }
  }
}
