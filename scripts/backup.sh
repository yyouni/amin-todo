#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run from the release directory. Compose reads its release-specific .env.
output=${1:-backups/todo-$(date -u +%Y%m%dT%H%M%SZ).dump}
mkdir -p -- "$(dirname -- "$output")"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$output.tmp"
mv -- "$output.tmp" "$output"
printf 'Backup saved: %s\n' "$output"
