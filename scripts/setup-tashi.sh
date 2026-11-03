#!/usr/bin/env bash
# Tashi Penjor - Frontend (the web pages students, staff and admins use)
# Run from anywhere:  ./scripts/setup-tashi.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

printf '\n%s CCMS - Frontend (Tashi) %s\n\n' "$BOLD" "$OFF"
need_node
check_port 5173 "the frontend"

# The frontend has no dependencies and no build step, so it needs nothing
# installed. It does need the backend services to show real data.
missing=""
curl -sf --max-time 2 http://localhost:3000/health >/dev/null 2>&1 || missing="$missing  - Auth Service (3000): ./scripts/setup-namgay.sh\n"
curl -sf --max-time 2 http://localhost:3001/health >/dev/null 2>&1 || missing="$missing  - Complaint Service (3001): ./scripts/setup-dechen.sh\n"
curl -sf --max-time 2 http://localhost:3002/health >/dev/null 2>&1 || missing="$missing  - Notification Service (3002): ./scripts/setup-dupchu.sh\n"

if [ -n "$missing" ]; then
  warn "These backend services are not running:"
  printf "$missing"
  warn "The page will load, but signing in needs at least the Auth Service."
  warn "To run everything yourself in one terminal: ./scripts/dev-all.sh"
  printf '\n'
fi

cat <<'INFO'

You own: frontend/
  index.html   page structure
  style.css    styling
  app.js       all the behaviour: sign in, submit, assign, statistics

No build step. Edit a file, then refresh the browser.

Sign in with any of these (password Password123! for all):
  student@ccms.edu   submit complaints, track and close them
  staff@ccms.edu     see assigned work, start it, resolve it
  admin@ccms.edu     see everything, assign staff, view statistics

INFO

cd frontend
printf '\n%sFrontend is starting on http://localhost:5173%s\n' "$BOLD" "$OFF"
printf 'Press Ctrl+C to stop.\n\n'
PORT=5173 node serve.js
