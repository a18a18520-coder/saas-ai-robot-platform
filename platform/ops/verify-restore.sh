#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:?DB_PORT is required}"
: "${DB_USER:?DB_USER is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"

test -f "$BACKUP_FILE"
test -f "$BACKUP_FILE.sha256"
(cd "$(dirname "$BACKUP_FILE")" && shasum -a 256 -c "$(basename "$BACKUP_FILE").sha256")

verify_db="restore_verify_$(date -u +%Y%m%d%H%M%S)_$$"
cleanup() { dropdb --if-exists --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" "$verify_db" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" "$verify_db"
pg_restore --exit-on-error --no-owner --no-privileges --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --dbname "$verify_db" "$BACKUP_FILE"
table_count="$(psql --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --dbname "$verify_db" --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
if [[ "$table_count" -lt 10 ]]; then
  printf 'Restore verification failed: only %s application tables found\n' "$table_count" >&2
  exit 1
fi
printf 'Restore verified in isolated database (%s tables)\n' "$table_count"
