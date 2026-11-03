output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  value = aws_subnet.private_app[*].id
}

output "private_db_subnet_ids" {
  value = aws_subnet.private_db[*].id
}

output "nat_gateway_public_ip" {
  value = aws_eip.nat.public_ip
}

output "availability_zones" {
  value = var.azs
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.this.name
}

output "s3_gateway_endpoint_id" {
  value = aws_vpc_endpoint.s3.id
}

output "security_group_ids" {
  value = {
    vpclink = aws_security_group.vpclink.id
    alb     = aws_security_group.alb.id
    ecs     = aws_security_group.ecs.id
    lambda  = aws_security_group.lambda.id
    rds     = aws_security_group.rds.id
  }
}
