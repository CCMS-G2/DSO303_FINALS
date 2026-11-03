#!/usr/bin/env bash
# Namgay Wangchuk - Auth Service (login, roles, user management)
# Run from anywhere:  ./scripts/setup-namgay.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

printf '\n%s CCMS - Auth Service (Namgay) %s\n\n' "$BOLD" "$OFF"
need_node
ensure_env
ensure_shared_services
install_deps services/auth-service
check_port 3000 "the Auth Service"

cat <<'INFO'

You own: services/auth-service/src/
  app.js              routes: register, login, /me, user management
  middleware/auth.js  verifies the token and checks roles

Try it once it starts (in a second terminal):
  curl localhost:3000/health
  curl -X POST localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@ccms.edu","password":"Password123!"}'

INFO

run_service services/auth-service 3000 "Auth Service" \
  DATABASE_URL="$DB_URL" PORT=3000
