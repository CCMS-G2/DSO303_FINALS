# First two Availability Zones in the region (ap-south-1a, ap-south-1b)
data "aws_availability_zones" "available" {
  state = "available"
}

module "network" {
  source = "./modules/network"

  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  project                  = var.project
  vpc_cidr                 = var.vpc_cidr
  public_subnet_cidrs      = var.public_subnet_cidrs
  private_app_subnet_cidrs = var.private_app_subnet_cidrs
  private_db_subnet_cidrs  = var.private_db_subnet_cidrs
  alb_prod_port            = var.alb_prod_port
  service_ports            = var.service_ports
}

# Later steps add one module block per folder in ./modules, in this order:
#   ecr -> database -> secrets -> storage -> ecs -> messaging -> notification
#   -> api -> cdn -> cicd -> monitoring
