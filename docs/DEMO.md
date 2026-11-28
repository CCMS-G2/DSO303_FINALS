# Recording the CCMS demo

A run sheet for the final demo video, following the proposal's six demonstration scenarios.
Run every command from the repository root. All helpers use the `ccms` AWS profile.

## Before you press record

- [ ] Stack is up: `scripts/demo.sh status` shows 2/2 tasks per service and all alarms `OK`.
      If not, run `scripts/aws-up.sh` (about 20 minutes).
- [ ] SES sender verified and SNS alert subscription confirmed (links were emailed to the
      `ses_sender_email` / `alert_email` address in `terraform.tfvars`).
- [ ] GitHub connection `ccms-github` shows **Available** under Developer Tools → Settings → Connections
      (only needed for scenario 3).
- [ ] Start scenario 6 (`scripts/demo.sh break-lambda`) about 10 minutes before you record it.
      The dead-letter queue only fills after 3 retries × 180 s.
- [ ] Open these tabs (`scripts/demo.sh urls` prints them all): the app, the CCMS-Overview dashboard,
      the ECS cluster, CodePipeline, SQS queues, and your inbox.
- [ ] Set the dashboard time range to **1h** and turn on auto-refresh (10 s).

## Where the URLs come from

| What | Where to find it |
|---|---|
| App | `scripts/demo.sh urls`, or the console: CloudFront → Distributions → *Domain name* |
| API | API Gateway → APIs → `ccms-api` → *Invoke URL*. Opening the root shows `{"message":"Not Found"}`; that is expected, because every route is under `/api/...` |
| Dashboard | CloudWatch → Dashboards → `CCMS-Overview` |

## Scenarios

| # | Show | How |
|---|---|---|
| 1 | Student submits a complaint with a photo and gets a confirmation | Sign in to the app as `student@ccms.edu`, create a complaint with a photo, then show the bell icon and the email. |
| 2 | Admin assigns, staff resolves, student closes; a notification at every step | In the app: `admin@` assigns to Sonam Staff → `staff@` starts and resolves with a note → `student@` closes. For a quick terminal version: `scripts/demo.sh e2e`. |
| 3 | A merged change deploys automatically | Make a small visible change in `services/complaint-service` on a branch, merge the PR, then show `ccms-complaint-service` running Source → Build → Deploy in CodePipeline (about 10 minutes). |
| 4 | A task is killed and the app stays up | `scripts/demo.sh kill-task` stops one auth task and polls login every 2 s. Logins keep returning 200 while ECS starts a replacement. Show the ECS *Tasks* tab. Press Ctrl+C when running is back to 2. |
| 5 | Load makes ECS scale out from 2 to 4 tasks | `scripts/demo.sh load` (about 6.5 minutes). Show the dashboard's *ECS running tasks* and *CPU* widgets, then the k6 summary (p95 under 1 s). Scale-in happens later, after load stops. |
| 6 | A broken Lambda sends events to the DLQ and an alarm email | `scripts/demo.sh break-lambda`, then submit a complaint. After about 10 minutes `scripts/demo.sh status` shows the DLQ at 1 and `ccms-dlq-not-empty` in `ALARM`, and the email arrives. Restore with `scripts/demo.sh fix-lambda`, which also redrives the DLQ. |

Also worth showing: CloudWatch Logs Insights on `/ccms/complaint-service` (JSON logs with `requestId`),
ECR image scan results, Secrets Manager (`ccms/database`, `ccms/jwt-secret`), and the private S3 evidence bucket.

## After recording

```bash
scripts/demo.sh fix-lambda   # if you used scenario 6
scripts/aws-down.sh          # stops the roughly USD 4-6/day charges
```
