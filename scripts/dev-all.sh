#!/usr/bin/env bash
# Runs all three services plus the frontend in one terminal.
# Useful for testing the whole app, or for demos.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

printf '\n%s CCMS - running the whole application %s\n\n' "$BOLD" "$OFF"
need_node
ensure_env
ensure_shared_services
for s in auth-service complaint-service notification-service; do install_deps "services/$s"; done
for p in 3000 3001 3002 5173; do check_port "$p" "CCMS"; done

mkdir -p .logs
pids=""
start() {
  local dir="$1" name="$2"; shift 2
  (cd "$dir" && env "$@" node src/app.js > "$REPO_ROOT/.logs/$name.log" 2>&1) &
  pids="$pids $!"
  say "Started $name (logs: .logs/$name.log)"
}

cleanup() { printf '\nStopping...\n'; for p in $pids; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

start services/auth-service auth DATABASE_URL="$DB_URL" PORT=3000
start services/complaint-service complaint DATABASE_URL="$DB_URL" PORT=3001 \
  AUTH_SERVICE_URL=http://localhost:3000 NOTIFICATION_URL=http://localhost:3002
start services/notification-service notification DATABASE_URL="$DB_URL" PORT=3002 \
  AUTH_SERVICE_URL=http://localhost:3000 SMTP_HOST=localhost SMTP_PORT=1025

sleep 2
ok=true
for pair in "3000 Auth" "3001 Complaint" "3002 Notification"; do
  set -- $pair
  if curl -sf --max-time 3 "http://localhost:$1/health" >/dev/null 2>&1; then
    say "$2 Service is healthy on port $1"
  else
    warn "$2 Service did not start - see .logs/"; ok=false
  fi
done
$ok || warn "Some services failed. The frontend will still open."

printf '\n%sOpen http://localhost:5173 in your browser%s\n' "$BOLD" "$OFF"
printf 'Emails appear at http://localhost:8025\n'
printf 'Press Ctrl+C to stop everything.\n\n'
(cd frontend && PORT=5173 node serve.js)
