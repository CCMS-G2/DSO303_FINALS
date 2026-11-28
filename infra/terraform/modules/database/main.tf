# Amazon RDS for PostgreSQL: one instance, one schema per service (proposal, Section 15).
resource "random_password" "master" {
  length  = 32
  special = false # keeps the password safe to embed in a connection URL
}

resource "aws_db_instance" "this" {
  identifier     = "${var.project}-postgres"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true # encryption at rest with the AWS-managed KMS key

  db_name  = var.db_name
  username = var.username
  password = random_password.master.result
  port     = 5432

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false
  multi_az               = false # cost decision (proposal, Limitations); one setting to change for production

  backup_retention_period    = var.backup_retention_days
  auto_minor_version_upgrade = true
  apply_immediately          = true

  # Demo environment: allow a clean `terraform destroy`.
  skip_final_snapshot = true
  deletion_protection = false
}
