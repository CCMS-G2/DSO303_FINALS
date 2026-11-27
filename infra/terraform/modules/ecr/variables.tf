variable "project" {
  type = string
}

variable "repositories" {
  description = "One repository per container service."
  type        = list(string)
}
