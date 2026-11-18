#!/usr/bin/env bash
# Database backup with retention.
#
# Runs against DIRECT_DATABASE_URL — pg_dump needs a session-scoped connection
# and must not go through a transaction pooler.
#
# This writes LOCALLY. A backup on the same machine as the database protects
# against a bad migration, not against losing the machine; ship the output to
# object storage in another region for that.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
URL="${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "$URL" ]; then
  echo "error: set DIRECT_DATABASE_URL (or DATABASE_URL)" >&2
  exit 1
fi

# Prisma accepts ?schema=... in its URL; pg_dump rejects it as an unknown
# query parameter, so strip Prisma-only options before handing the URL over.
URL="$(printf '%s' "$URL" | sed -E 's/[?&]schema=[^&]*//; s/[?&]connection_limit=[^&]*//; s/[?&]pgbouncer=[^&]*//')"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/skyup_auth-$STAMP.dump"

# Custom format: compressed, and restorable table-by-table with pg_restore.
pg_dump --format=custom --no-owner --no-acl --file="$OUT" "$URL"

# Verify the dump is readable before trusting it — a backup nobody can restore
# is not a backup.
pg_restore --list "$OUT" > /dev/null

SIZE="$(du -h "$OUT" | cut -f1)"
echo "backup ok: $OUT ($SIZE)"

DELETED="$(find "$BACKUP_DIR" -name 'skyup_auth-*.dump' -mtime "+$RETAIN_DAYS" -print -delete | wc -l | tr -d ' ')"
echo "retention: kept ${RETAIN_DAYS}d, removed $DELETED old backup(s)"
