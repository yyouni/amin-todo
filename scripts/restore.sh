#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 && -f "$1" ]] || { echo 'Usage: bash scripts/restore.sh backup.dump' >&2; exit 1; }
# Explicit restore command: stop writes, replace DB objects, then restart application.
docker compose stop api web
docker compose exec -T db sh -c 'pg_restore --exit-on-error --single-transaction --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$1"
docker compose up -d --no-build --wait api web
