output "connection_arn" {
  value = aws_codestarconnections_connection.github.arn
}

output "connection_status" {
  description = "PENDING until approved once in the AWS console."
  value       = aws_codestarconnections_connection.github.connection_status
}

output "pipeline_names" {
  value = { for k, p in aws_codepipeline.service : k => p.name }
}
