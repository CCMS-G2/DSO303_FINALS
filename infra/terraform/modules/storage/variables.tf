variable "project" {
  type = string
}

variable "allowed_origins" {
  description = "Origins allowed to upload directly (the CloudFront frontend URL)."
  type        = list(string)
}
