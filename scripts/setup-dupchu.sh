#!/usr/bin/env bash
# Dupchu Wangmo - Notification Service, database and shared infrastructure
# Run from anywhere:  ./scripts/setup-dupchu.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

printf '\n%s CCMS - Notification Service + infrastructure (Dupchu) %s\n\n' "$BOLD" "$OFF"
need_node
ensure_env
ensure_shared_services
install_deps services/notification-service
check_port 3002 "the Notification Service"

if ! curl -sf --max-time 2 http://localhost:3000/health >/dev/null 2>&1; then
  warn "Auth Service (port 3000) is not running - emails cannot look up addresses."
  warn "In-app notifications still get stored. Run ./scripts/setup-namgay.sh to fix."
fi

cat <<'INFO'

You own:
  services/notification-service/src/app.js   event intake, email, notifications
  db/init.sql                                the database schema for all services
  docker-compose.yml                         Postgres, MailHog and the services

Emails go to MailHog, not the internet: http://localhost:8025

Changing the schema: edit db/init.sql, then reset the database with
  docker compose down -v && docker compose up -d postgres
(this deletes all local data and reloads the schema from scratch)

Connect to the database directly:
  docker compose exec postgres psql -U ccms -d ccms

INFO

run_service services/notification-service 3002 "Notification Service" \
  DATABASE_URL="$DB_URL" PORT=3002 \
  AUTH_SERVICE_URL=http://localhost:3000 \
  SMTP_HOST=localhost SMTP_PORT=1025
