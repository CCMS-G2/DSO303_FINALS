output "function_names" {
  value = { for k, f in aws_lambda_function.fn : k => f.function_name }
}

output "api_function_name" {
  value = aws_lambda_function.fn["api"].function_name
}

output "api_invoke_arn" {
  value = aws_lambda_function.fn["api"].invoke_arn
}
