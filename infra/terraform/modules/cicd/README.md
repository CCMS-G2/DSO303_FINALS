# cicd module

**Roadmap step 16.** Not built yet.

CodePipeline (GitHub connection, path filters per service) and CodeBuild projects running each service's `buildspec.yml`.

When built, this folder holds `main.tf`, `variables.tf` and `outputs.tf`, and is called from `../../main.tf` as `module "cicd"`.
