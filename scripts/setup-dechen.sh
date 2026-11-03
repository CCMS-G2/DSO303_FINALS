#!/usr/bin/env bash
# Dechen Wangdra Sherpa - Complaint Service (lifecycle, assignment, uploads, stats)
# Run from anywhere:  ./scripts/setup-dechen.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

printf '\n%s CCMS - Complaint Service (Dechen) %s\n\n' "$BOLD" "$OFF"
need_node
ensure_env
ensure_shared_services
install_deps services/complaint-service
check_port 3001 "the Complaint Service"

# The Complaint Service calls the Auth Service to check that a user really
# is active staff before assigning work to them. Without it, everything
# else still works - only assignment fails, with a clear 502.
if ! curl -sf --max-time 2 http://localhost:3000/health >/dev/null 2>&1; then
  warn "Auth Service (port 3000) is not running."
  warn "Everything works except assigning a complaint. Ask Namgay to start it,"
  warn "or run ./scripts/setup-namgay.sh yourself in another terminal."
fi

cat <<'INFO'

You own: services/complaint-service/src/
  app.js        lifecycle rules, assignment, notes, statistics, uploads
  eventBus.js   publishes events (becomes an SQS send on AWS)

Try it once it starts (in a second terminal):
  curl localhost:3001/health
  TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"student@ccms.edu","password":"Password123!"}' \
    | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
  curl localhost:3001/api/complaints -H "Authorization: Bearer $TOKEN"

INFO

run_service services/complaint-service 3001 "Complaint Service" \
  DATABASE_URL="$DB_URL" PORT=3001 \
  AUTH_SERVICE_URL=http://localhost:3000 \
  NOTIFICATION_URL=http://localhost:3002
