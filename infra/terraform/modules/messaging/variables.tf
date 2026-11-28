variable "project" {
  type = string
}

variable "visibility_timeout_seconds" {
  type    = number
  default = 180
}

variable "max_receive_count" {
  description = "Failed receives before a message moves to the DLQ (proposal: 3)."
  type        = number
  default     = 3
}
