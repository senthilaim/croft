#!/bin/sh
# Croft installer. Run from a clone:   ./install.sh
# or remotely:  curl -fsSL https://raw.githubusercontent.com/senthilaim/croft/main/install.sh | sh
set -eu

REPO_RAW="${CROFT_RAW_URL:-https://raw.githubusercontent.com/senthilaim/croft/main}"
DIR="${CROFT_DIR:-}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is not installed. Get it from https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker and re-run."
docker compose version >/dev/null 2>&1 || die "'docker compose' (v2) is required."

ver=$(docker compose version --short 2>/dev/null | sed 's/^v//')
major=${ver%%.*}; rest=${ver#*.}; minor=${rest%%.*}
if [ "${major:-0}" -lt 2 ] || { [ "${major:-0}" -eq 2 ] && [ "${minor:-0}" -lt 23 ]; }; then
  die "Docker Compose 2.23+ is required (found $ver). Please upgrade Docker."
fi

if [ -z "$DIR" ]; then
  if [ -f docker-compose.yml ] && [ -f .env.example ]; then DIR=.; else DIR="$HOME/croft"; fi
fi
mkdir -p "$DIR"; cd "$DIR"

if [ ! -f docker-compose.yml ]; then
  command -v curl >/dev/null 2>&1 || die "curl is required to download the compose file."
  say "Downloading docker-compose.yml and croft into $(pwd) ..."
  curl -fsSL "$REPO_RAW/docker-compose.yml" -o docker-compose.yml
  curl -fsSL "$REPO_RAW/croft" -o croft
  chmod +x croft
fi

if [ ! -f .env ]; then
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."
  say "Generating secrets into .env (kept across re-runs) ..."
  umask 077
  {
    echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
    echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
    echo "AUTOMATION_INTERNAL_TOKEN=$(openssl rand -hex 32)"
  } > .env
else
  say "Keeping existing .env"
fi

say "Starting Croft (first run pulls images; this can take a few minutes) ..."
docker compose up -d --pull missing --wait

say ""
say "Croft is running:  http://localhost:3000"
say "Note: your first workspace pulls the Buildfarm image (~300 MB), so the first provision is slow."
say "Manage it with ./croft (up | down | logs | upgrade | status)."
say "Security: Croft mounts the Docker socket to create your Buildfarm containers, and is bound to localhost only."
