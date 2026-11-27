# CCMS — Campus Complaint Management System

Local development setup. DSO303 Cloud Native Solution Design, College of Science and Technology.

## Who owns what

| Member | Owns | Folder | Port |
|---|---|---|---|
| Namgay Wangchuk | Auth Service — login, roles, user accounts | `services/auth-service` | 3000 |
| Dechen Wangdra Sherpa | Complaint Service — lifecycle, assignment, uploads, statistics | `services/complaint-service` | 3001 |
| Dupchu Wangmo | Notification Service, database schema, Docker setup | `services/notification-service` | 3002 |
| Tashi Penjor | Frontend — the pages everyone uses | `frontend` | 5173 |

Everyone can read and edit every file.

## Before you start (once per machine)

Install **Node.js 18+** and **Docker**.

- macOS: `brew install node`, plus Docker Desktop from docker.com
- Linux: `sudo apt install nodejs npm docker.io docker-compose-plugin`

On Linux, so you don't need `sudo` for every Docker command:

```bash
sudo usermod -aG docker $USER   # then log out and back in
```

## Getting started

```bash
git clone <your-repo-url> ccms
cd ccms
```

There are two ways to run the app.

### Option A: everything in Docker (easiest to demo)

```bash
cp .env.example .env
docker compose up --build
```

This starts Postgres, MailHog, and all three services. The frontend is not in Docker.
Start it in a second terminal:

```bash
cd frontend && PORT=5173 node serve.js
```

Then open **http://localhost:5173**.

### Option B: your own service directly (what you'll use while coding)

Start the shared pieces once. Running it again is harmless.

```bash
docker compose up -d postgres mailhog
```

Install each service's dependencies once, then run it. Each command below is
self-contained: it sets its own environment variables and restarts on save.

```bash
cd services/auth-service && npm install && cd ../..
cd services/complaint-service && npm install && cd ../..
cd services/notification-service && npm install && cd ../..
```

**Namgay (Auth Service, port 3000):**

```bash
cd services/auth-service
DATABASE_URL=postgresql://ccms:ccms_dev_password@localhost:5432/ccms PORT=3000 JWT_SECRET=dev-only-change-me node --watch src/app.js
```

**Dechen (Complaint Service, port 3001):**

```bash
cd services/complaint-service
DATABASE_URL=postgresql://ccms:ccms_dev_password@localhost:5432/ccms PORT=3001 JWT_SECRET=dev-only-change-me AUTH_SERVICE_URL=http://localhost:3000 NOTIFICATION_URL=http://localhost:3002 node --watch src/app.js
```

**Dupchu (Notification Service, port 3002):**

```bash
cd services/notification-service
DATABASE_URL=postgresql://ccms:ccms_dev_password@localhost:5432/ccms PORT=3002 JWT_SECRET=dev-only-change-me AUTH_SERVICE_URL=http://localhost:3000 SMTP_HOST=localhost SMTP_PORT=1025 node --watch src/app.js
```

**Tashi (Frontend, port 5173):**

```bash
cd frontend && PORT=5173 node serve.js
```

Run each command in its own terminal. Press `Ctrl+C` to stop a service.

Check that the backend is up. Each should return a 200 response:

```bash
curl localhost:3000/health
curl localhost:3001/health
curl localhost:3002/health
```

Everyone must use the same `JWT_SECRET`. A token signed by one service is rejected by the
others if the secrets differ. The value above is the shared development value.

## Test accounts

All use the password `Password123!`

| Email | Role | Can do |
|---|---|---|
| `student@ccms.edu` | Student | Submit complaints, track them, close resolved ones |
| `staff@ccms.edu` | Staff | See assigned complaints, start work, resolve them |
| `admin@ccms.edu` | Admin | See everything, assign staff, view statistics, manage users |

Try the Auth Service once it is running:

```bash
curl localhost:3000/health
curl -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ccms.edu","password":"Password123!"}'
```

## How the pieces fit together

```
Browser (5173)
    |
    +--> Auth Service (3000) ---------+
    +--> Complaint Service (3001) ----+--> Postgres (5432)
    |         |                       |
    |         +--> publishes event    |
    |              to Notification    |
    +--> Notification Service (3002) -+--> MailHog (8025)
```

- **Emails** go to MailHog at http://localhost:8025, never to the internet.
- **Photos** upload in two steps: ask the Complaint Service for an upload URL, then send the file to it. On AWS that URL becomes an S3 pre-signed link, and the frontend code does not change.
- **Events** are sent as HTTP calls to the Notification Service. On AWS they become SQS messages (`eventBus.js` picks the transport from the environment).

## Complaint lifecycle

```
SUBMITTED --> ASSIGNED --> IN_PROGRESS --> RESOLVED --> CLOSED
```

| Change | Who is allowed |
|---|---|
| Assign or reassign | Admin only |
| Start work (`IN_PROGRESS`) | Only the assigned staff member |
| Resolve | Only the assigned staff member, and a note is required |
| Close | The student who submitted it, or an admin |

Anything else is rejected. The server enforces this, not the browser.

## Stopping

```bash
docker compose down        # stop the database and MailHog, keep the data
docker compose down -v     # stop and delete all local data
```

Stop Option A with `Ctrl+C`, then run `docker compose down`.

## Working together

```bash
git pull                     # get everyone else's latest work
# ... make your changes ...
git add -A && git commit -m "describe what you did"
git push
```

Only edit files you own unless you tell the owner first — that avoids merge conflicts.

`.env`, `node_modules/` and uploaded files are deliberately not in Git.
`.env` is only needed for Option A; it is created by `cp .env.example .env`.

## When something breaks

| Problem | Fix |
|---|---|
| `Docker is installed but not running` | Start Docker Desktop, or `sudo systemctl start docker` |
| `Port 3000 is already in use` | `lsof -iTCP:3000 -sTCP:LISTEN`, then stop that process |
| `Postgres did not become ready` | `docker compose logs postgres` |
| Service exits with a `JWT_SECRET` error | Add `JWT_SECRET=dev-only-change-me` to the command |
| Database looks wrong after a schema change | `docker compose down -v && docker compose up -d postgres mailhog` |
| Sign-in fails in the browser | The Auth Service isn't running — start it with the Namgay command above |
| Assigning a complaint returns 502 | Same: the Complaint Service needs the Auth Service |

Inspect the database directly:

```bash
docker compose exec postgres psql -U ccms -d ccms
```

## Project layout

```
ccms/
  db/init.sql                      schema + seed data, loads automatically
  docker-compose.yml               Postgres, MailHog, and all services
  .env.example                     copied to .env for Option A
  frontend/                        index.html, style.css, app.js, config.js, serve.js
  services/
    auth-service/src/app.js
    complaint-service/src/app.js   + eventBus.js (HTTP locally, SQS on AWS)
    notification-service/src/      notifier.js (shared logic), app.js (local), lambda.js (AWS)
  infra/terraform/                 all AWS infrastructure, one module per concern
  scripts/aws-up.sh, aws-down.sh   deploy to / remove from your AWS account
```

## Running on AWS

The same code runs in both places; environment variables decide which backing service is used:

| Local | On AWS |
|---|---|
| Postgres in Docker | RDS PostgreSQL |
| MailHog | Amazon SES |
| HTTP call in `eventBus.js` | SQS message |
| Notification Service | Lambda triggered by SQS |
| Upload URL from disk storage | S3 pre-signed URL |
| Services run with `node` | Docker containers on ECS Fargate |
| Frontend on `serve.js` | S3 + CloudFront |

### Deploying to your own AWS account

Each member deploys the whole stack to **their own AWS account**. The Terraform code is
shared; the account details are not. Two git-ignored files hold your personal values:

| Template (committed) | Your copy (git-ignored) | What you put in it |
|---|---|---|
| `infra/terraform/backend.hcl.example` | `infra/terraform/backend.hcl` | Your own state bucket name |
| `infra/terraform/terraform.tfvars.example` | `infra/terraform/terraform.tfvars` | Your AWS CLI profile name |

Your AWS access keys never go in the repo. `aws configure` stores them in `~/.aws/credentials`.

One-time setup:

```bash
# 1. Save your access keys under the profile name "ccms"
aws configure --profile ccms
aws sts get-caller-identity --profile ccms      # note the "Account" number

# 2. Create a bucket for your Terraform state (bucket names are global, so include your account ID)
aws s3api create-bucket --bucket ccms-tfstate-<ACCOUNT_ID> --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1 --profile ccms
aws s3api put-bucket-versioning --bucket ccms-tfstate-<ACCOUNT_ID> \
  --versioning-configuration Status=Enabled --profile ccms

# 3. Make your personal copies and fill in the bucket name
cd infra/terraform
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars

# 4. Initialise (Terraform 1.11 or newer)
terraform init -backend-config=backend.hcl
```

Optional settings in your `terraform.tfvars`:

```hcl
ses_sender_email = "you@example.com"   # enables email; click the verification link AWS sends
alert_email      = "you@example.com"   # alarm + budget emails; confirm the SNS subscription email
```

Deploy and remove (Docker Desktop must be running for deploy):

```bash
scripts/aws-up.sh     # build + push images, terraform apply, load schema, roll out (~20 min first time)
scripts/aws-down.sh   # destroy everything except the state bucket
```

`aws-up.sh` prints the CloudFront URL at the end. Log in with the test accounts above.

Rules:

- **Never commit `backend.hcl`, `terraform.tfvars` or `.env`.** They are git-ignored; keep it that way.
- **Run `scripts/aws-down.sh` when you finish a session.** The full stack costs roughly USD 4-6 a day.
  Set up an AWS Budgets alert in your own account before your first `apply`.
- If you switch to another member's account on the same machine, delete `.terraform/` and run
  `terraform init -backend-config=backend.hcl -reconfigure`.
- The **final demo runs from one agreed account**; the others are for learning and testing.

Note that an **AWS Academy Learner Lab** account has real limits: credentials expire
every few hours, you usually cannot create IAM roles (there is one pre-made `LabRole`),
and the account can reset between sessions. Keep everything reproducible as code.
