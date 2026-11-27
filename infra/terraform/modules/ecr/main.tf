# Private image registries for the two container services.
resource "aws_ecr_repository" "this" {
  for_each = toset(var.repositories)

  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "MUTABLE" # "latest" is moved on every push; commit-SHA tags are kept for rollback
  force_delete         = true      # lets `terraform destroy` remove repositories that still hold images

  image_scanning_configuration {
    scan_on_push = true # vulnerability scan on every push (proposal, supply chain)
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "keep_recent" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 most recent images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}
