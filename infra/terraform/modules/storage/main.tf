# Private evidence bucket. Browsers upload and view photos with short-lived
# pre-signed URLs issued by the Complaint Service; the bucket is never public.
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "evidence" {
  bucket        = "${var.project}-evidence-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # demo environment: allow `terraform destroy` with photos inside
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # SSE-S3 (proposal, data protection)
    }
  }
}

# The browser PUTs directly to S3 from the CloudFront origin.
resource "aws_s3_bucket_cors_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = var.allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Refuse any request that is not over HTTPS.
resource "aws_s3_bucket_policy" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.evidence]
}
