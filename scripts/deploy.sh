#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# -eq 3 ]] || { echo 'Usage: deploy.sh /absolute/root COMMIT_SHA ghcr.io/owner/repo' >&2; exit 1; }
root=$1
release_sha=$2
image_prefix=$3
[[ "$root" =~ ^/[a-zA-Z0-9_/-]+$ && "$root" != / && "$release_sha" =~ ^[a-f0-9]{40}$ && "$image_prefix" =~ ^ghcr.io/[a-z0-9._/-]+$ ]] || exit 1
mkdir -p "$root/releases" "$root/backups"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is in progress' >&2; exit 1; }
[[ -f "$root/.env" ]] || { echo "Create $root/.env before deployment" >&2; exit 1; }
release="$root/releases/$release_sha"
mkdir -p "$release"
tar -xzf "$root/incoming/$release_sha.tar.gz" -C "$release"
install -m 600 "$root/.env" "$release/.env"
printf '\nIMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$image_prefix" "$release_sha" >> "$release/.env"
export IMAGE_PREFIX="$image_prefix" IMAGE_TAG="$release_sha"
compose() { docker compose --env-file "$release/.env" --project-directory "$release" -f "$release/compose.yml" -f "$release/compose.prod.yml" -f "$release/compose.monitoring.yml" "$@"; }
previous=$(readlink -f "$root/current" 2>/dev/null || true)
compose config --quiet
compose pull
compose up -d --no-build --wait db
backup="$root/backups/pre-$release_sha-$(date -u +%Y%m%dT%H%M%SZ).dump"
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup.tmp"
mv "$backup.tmp" "$backup"
# Migration failure leaves existing app containers running. No automatic schema rollback.
compose run --rm --no-deps migrate
if ! compose up -d --no-build --wait --wait-timeout 180; then
  echo 'Deployment failed. Restoring previous app images when available.' >&2
  if [[ -n "$previous" && -f "$previous/compose.yml" && "$(basename "$previous")" =~ ^[a-f0-9]{40}$ ]]; then
    IMAGE_TAG=$(basename "$previous") docker compose --env-file "$previous/.env" --project-directory "$previous" -f "$previous/compose.yml" -f "$previous/compose.prod.yml" up -d --no-build --no-deps --wait --wait-timeout 120 api web
  fi
  exit 1
fi
ln -sfn "$release" "$root/current"
printf 'Deployed %s\n' "$release_sha"
