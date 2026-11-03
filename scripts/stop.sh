#!/usr/bin/env bash
# Stops Postgres and MailHog. Your data is kept unless you pass --wipe.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [ "${1:-}" = "--wipe" ]; then
  warn "Deleting all local database data..."
  docker compose down -v
  say "Stopped and wiped. The next startup reloads db/init.sql from scratch."
else
  docker compose down
  say "Stopped. Data kept. Use './scripts/stop.sh --wipe' to delete it too."
fi
