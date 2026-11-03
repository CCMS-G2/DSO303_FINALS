# database module

**Roadmap step 6.** Not built yet.

Amazon RDS for PostgreSQL 16 (db.t4g.micro, 20 GB gp3, Single-AZ) in the private DB subnets, using `sg-rds` and the DB subnet group from `network`.

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "database"`.
