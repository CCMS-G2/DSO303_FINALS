#!/usr/bin/env bash
# Shared helpers for every member's setup script.
# Not run directly - the per-member scripts source this file.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; RED=$'\033[0;31m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '%s==>%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '%s==> ERROR:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# ---- prerequisites -------------------------------------------------

need_node() {
  command -v node >/dev/null 2>&1 || die "Node.js is not installed.
  macOS:  brew install node
  Linux:  sudo apt install nodejs npm"
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ] || die "Node 18 or newer is required (found $(node -v))."
}

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed.
  macOS:  install Docker Desktop from docker.com
  Linux:  sudo apt install docker.io docker-compose-plugin"
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop (macOS) or: sudo systemctl start docker"
}

# ---- shared setup --------------------------------------------------

ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    say "Created .env from .env.example"
  fi
  # Export .env so the services see JWT_SECRET (they do not read the file themselves).
  set -a; . ./.env; set +a
}

# Starts Postgres and MailHog. Safe to run repeatedly: if they are already
# up, Docker leaves them alone. Whoever runs their script first starts them.
ensure_shared_services() {
  need_docker
  say "Starting shared services (Postgres, MailHog)..."
  docker compose up -d postgres mailhog >/dev/null
  printf 'Waiting for Postgres'
  for _ in $(seq 1 45); do
    if docker compose exec -T postgres pg_isready -U ccms >/dev/null 2>&1; then
      printf '\n'; say "Postgres is ready on localhost:5432"
      say "MailHog inbox: http://localhost:8025"
      return 0
    fi
    printf '.'; sleep 1
  done
  printf '\n'; die "Postgres did not become ready. Check: docker compose logs postgres"
}

# Installs dependencies only when they are missing or package.json changed.
install_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ] || [ "$dir/package.json" -nt "$dir/node_modules" ]; then
    say "Installing dependencies in $dir..."
    (cd "$dir" && npm install --silent)
  else
    say "Dependencies in $dir are up to date"
  fi
}

# Warns if a port is already in use, so the error is obvious rather than
# a confusing crash from Node.
check_port() {
  local port="$1" name="$2"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    die "Port $port is already in use, but $name needs it.
  Find it with:  lsof -iTCP:$port -sTCP:LISTEN
  Then stop that process and run this script again."
  fi
}

# Runs a service with automatic restart on file changes.
run_service() {
  local dir="$1" port="$2" name="$3"; shift 3
  printf '\n%s%s is starting on http://localhost:%s%s\n' "$BOLD" "$name" "$port" "$OFF"
  printf 'Press Ctrl+C to stop. Code changes reload automatically.\n\n'
  (cd "$dir" && env "$@" node --watch src/app.js)
}

DB_URL="postgresql://ccms:ccms_dev_password@localhost:5432/ccms"
