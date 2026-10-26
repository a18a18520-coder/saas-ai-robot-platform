#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:?DB_PORT is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/${DB_NAME}_${timestamp}.dump"

pg_dump --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --dbname "$DB_NAME" \
  --format=custom --compress=9 --no-owner --no-privileges --file "$backup_file"
shasum -a 256 "$backup_file" > "$backup_file.sha256"
pg_restore --list "$backup_file" >/dev/null
printf 'Backup verified: %s\n' "$backup_file"
