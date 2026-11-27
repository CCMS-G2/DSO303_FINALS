# CI/CD: one CodePipeline per container service (proposal, Section 18).
#
#   Source  : GitHub via AWS CodeConnections; a push to main that touches
#             services/<name>/** starts only that service's pipeline
#   Build   : CodeBuild runs services/<name>/buildspec.yml
#             (npm ci, npm audit, docker build, push :<commit> and :latest to ECR)
#   Deploy  : ECS rolling update; the service's circuit breaker rolls back
#             automatically if the new tasks fail their health checks
#
# The GitHub connection is created in PENDING state. Approve it once in the
# console (Developer Tools > Settings > Connections > Update pending connection).
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region   = data.aws_region.current.region
  account  = data.aws_caller_identity.current.account_id
  registry = "${local.account}.dkr.ecr.${local.region}.amazonaws.com"
}

resource "aws_codestarconnections_connection" "github" {
  name          = "${var.project}-github"
  provider_type = "GitHub"
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.project}-pipeline-artifacts-${local.account}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "expire-old-artifacts"
    status = "Enabled"
    filter {}
    expiration {
      days = 14
    }
  }
}

# ---------------------------------------------------------------------------
# CodeBuild
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "codebuild" {
  name               = "${var.project}-codebuild"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
}

resource "aws_iam_role_policy" "codebuild" {
  name = "build-and-push"
  role = aws_iam_role.codebuild.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/codebuild/${var.project}-*"
      },
      {
        Sid      = "Artifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.artifacts.arn}/*"
      },
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*" # this action does not support resource-level permissions
      },
      {
        Sid    = "EcrPushProjectReposOnly"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
        ]
        Resource = values(var.ecr_repository_arns)
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "codebuild" {
  for_each          = var.services
  name              = "/aws/codebuild/${var.project}-${each.key}"
  retention_in_days = 14
}

resource "aws_codebuild_project" "service" {
  for_each = var.services

  name          = "${var.project}-${each.key}"
  description   = "Audit, build and push the ${each.key} image"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 20

  source {
    type      = "CODEPIPELINE"
    buildspec = "services/${each.key}/buildspec.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true # needed to run docker build

    environment_variable {
      name  = "ECR_REGISTRY"
      value = local.registry
    }
    environment_variable {
      name  = "REPOSITORY_URI"
      value = each.value.repository_url
    }
    environment_variable {
      name  = "SERVICE_DIR"
      value = "services/${each.key}"
    }
    environment_variable {
      name  = "CONTAINER_NAME"
      value = each.value.container_name
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.codebuild[each.key].name
    }
  }
}

# ---------------------------------------------------------------------------
# CodePipeline
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "pipeline_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codepipeline.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pipeline" {
  name               = "${var.project}-codepipeline"
  assume_role_policy = data.aws_iam_policy_document.pipeline_assume.json
}

resource "aws_iam_role_policy" "pipeline" {
  name = "run-pipeline"
  role = aws_iam_role.pipeline.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Artifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:GetObjectVersion", "s3:GetBucketVersioning"]
        Resource = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
      },
      {
        Sid      = "GitHubSource"
        Effect   = "Allow"
        Action   = ["codestar-connections:UseConnection", "codeconnections:UseConnection"]
        Resource = aws_codestarconnections_connection.github.arn
      },
      {
        Sid      = "Build"
        Effect   = "Allow"
        Action   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"]
        Resource = [for p in aws_codebuild_project.service : p.arn]
      },
      {
        Sid    = "DeployToEcs"
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:DescribeTasks", "ecs:ListTasks",
          "ecs:RegisterTaskDefinition", "ecs:UpdateService", "ecs:TagResource",
        ]
        Resource = "*" # RegisterTaskDefinition/Describe* do not support resource-level permissions
      },
      {
        Sid       = "PassTaskRoles"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = var.ecs_task_role_arns
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_codepipeline" "service" {
  for_each = var.services

  name          = "${var.project}-${each.key}"
  role_arn      = aws_iam_role.pipeline.arn
  pipeline_type = "V2"

  artifact_store {
    location = aws_s3_bucket.artifacts.bucket
    type     = "S3"
  }

  # Only pushes to main that change this service's folder start this pipeline.
  trigger {
    provider_type = "CodeStarSourceConnection"
    git_configuration {
      source_action_name = "Source"
      push {
        branches {
          includes = [var.branch]
        }
        file_paths {
          includes = ["services/${each.key}/**"]
        }
      }
    }
  }

  stage {
    name = "Source"
    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source"]
      configuration = {
        ConnectionArn    = aws_codestarconnections_connection.github.arn
        FullRepositoryId = var.github_repository
        BranchName       = var.branch
        DetectChanges    = "false" # the V2 trigger above decides when to run
      }
    }
  }

  stage {
    name = "Build"
    action {
      name             = "AuditBuildPush"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source"]
      output_artifacts = ["imagedefinitions"]
      configuration = {
        ProjectName = aws_codebuild_project.service[each.key].name
      }
    }
  }

  stage {
    name = "Deploy"
    action {
      name            = "RollingUpdate"
      category        = "Deploy"
      owner           = "AWS"
      provider        = "ECS"
      version         = "1"
      input_artifacts = ["imagedefinitions"]
      configuration = {
        ClusterName = var.ecs_cluster_name
        ServiceName = each.value.ecs_service_name
        FileName    = "imagedefinitions.json"
      }
    }
  }
}
