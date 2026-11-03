# CCMS — Campus Complaint Management System

Local development setup. DSO303 Cloud Native Solution Design, College of Science and Technology.

## Who owns what

| Member | Owns | Runs | Port |
|---|---|---|---|
| Namgay Wangchuk | Auth Service — login, roles, user accounts | `./scripts/setup-namgay.sh` | 3000 |
| Dechen Wangdra Sherpa | Complaint Service — lifecycle, assignment, uploads, statistics | `./scripts/setup-dechen.sh` | 3001 |
| Dupchu Wangmo | Notification Service, database schema, Docker setup | `./scripts/setup-dupchu.sh` | 3002 |
| Tashi Penjor | Frontend — the pages everyone uses | `./scripts/setup-tashi.sh` | 5173 |

Everyone can read and edit every file. The scripts just make it easy to run *your* part.

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
./scripts/setup-namgay.sh      # or whichever script is yours
```

The script installs what it needs, starts the shared database, and runs your service.
It is safe to run again any time. Press `Ctrl+C` to stop.

The first person to run a script starts Postgres and MailHog; everyone else reuses them.

### Running the whole app

```bash
./scripts/dev-all.sh           # all services + frontend in one terminal
```

Then open **http://localhost:5173**.

### Stopping

```bash
./scripts/stop.sh              # stop the database, keep the data
./scripts/stop.sh --wipe       # stop and delete all local data
```

## Test accounts

All use the password `Password123!`

| Email | Role | Can do |
|---|---|---|
| `student@ccms.edu` | Student | Submit complaints, track them, close resolved ones |
| `staff@ccms.edu` | Staff | See assigned complaints, start work, resolve them |
| `admin@ccms.edu` | Admin | See everything, assign staff, view statistics, manage users |

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
- **Events** are sent as HTTP calls to the Notification Service. On AWS they become SQS messages, and only `eventBus.js` changes.

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

## Working together

```bash
git pull                     # get everyone else's latest work
# ... make your changes ...
git add -A && git commit -m "describe what you did"
git push
```

Only edit files you own unless you tell the owner first — that avoids merge conflicts.

Note that `.env`, `node_modules/` and uploaded files are deliberately not in Git.
Your `.env` is created automatically from `.env.example`.

## When something breaks

| Problem | Fix |
|---|---|
| `Docker is installed but not running` | Start Docker Desktop, or `sudo systemctl start docker` |
| `Port 3000 is already in use` | `lsof -iTCP:3000 -sTCP:LISTEN`, then stop that process |
| `Postgres did not become ready` | `docker compose logs postgres` |
| Database looks wrong after a schema change | `docker compose down -v && docker compose up -d postgres` |
| Sign-in fails in the browser | The Auth Service isn't running — `./scripts/setup-namgay.sh` |
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
  .env.example                     copied to .env on first run
  frontend/                        index.html, style.css, app.js, serve.js
  services/
    auth-service/src/app.js
    complaint-service/src/app.js   + eventBus.js
    notification-service/src/app.js
  scripts/                         the setup scripts
```

## Later: moving to AWS

The code is already shaped for it. These are the only parts that change:

| Local now | On AWS |
|---|---|
| Postgres in Docker | RDS PostgreSQL |
| MailHog | Amazon SES |
| HTTP call in `eventBus.js` | SQS message |
| Notification Service | Lambda triggered by SQS |
| Upload URL from disk storage | S3 pre-signed URL |
| Services run with `node` | Docker containers on ECS Fargate |
| Frontend on `serve.js` | S3 + CloudFront |

Note that an **AWS Academy Learner Lab** account has real limits: credentials expire
every few hours, you usually cannot create IAM roles (there is one pre-made `LabRole`),
and the account can reset between sessions. Keep everything reproducible as code.
