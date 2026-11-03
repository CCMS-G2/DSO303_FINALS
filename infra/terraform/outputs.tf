output "vpc_id" {
  value = module.network.vpc_id
}

output "availability_zones" {
  value = module.network.availability_zones
}

output "public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "private_app_subnet_ids" {
  value = module.network.private_app_subnet_ids
}

output "private_db_subnet_ids" {
  value = module.network.private_db_subnet_ids
}

output "db_subnet_group_name" {
  value = module.network.db_subnet_group_name
}

output "nat_gateway_public_ip" {
  value = module.network.nat_gateway_public_ip
}

output "s3_gateway_endpoint_id" {
  value = module.network.s3_gateway_endpoint_id
}

output "security_group_ids" {
  value = module.network.security_group_ids
}
