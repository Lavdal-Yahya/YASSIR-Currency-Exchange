#!/usr/bin/env bash
# P8-06 · nightly pg_dump helper.
#
# Writes a compressed custom-format dump to $BACKUP_DIR named
# cx-YYYY-MM-DD-HHMM.dump, then prunes files older than
# $RETENTION_DAYS. Prints one line per action so cron mail is readable.
#
# Reads DATABASE_URL from the environment (same as the API). Requires
# `pg_dump` on PATH — the postgres client tooling installed system-wide
# or provided by a `postgres:16-alpine` sidecar container.
#
# Usage (host):    DATABASE_URL=... BACKUP_DIR=/srv/cx/backups ./api/scripts/backup.sh
# Usage (cron):    0 3 * * *  cd /opt/cx && ./api/scripts/backup.sh >> /var/log/cx-backup.log 2>&1
#
# Restore is verified by restore-rehearsal.sh — a backup that has never
# been restored is not a backup (architecture §7).

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:=./backups}"
: "${RETENTION_DAYS:=30}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d-%H%M)"
OUT="$BACKUP_DIR/cx-${STAMP}.dump"

echo "[backup] $(date -Iseconds) writing $OUT"
pg_dump \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --exclude-schema=_prisma_migrations \
    --dbname="$DATABASE_URL" \
    --file="$OUT"

BYTES="$(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT")"
echo "[backup] wrote $BYTES bytes"

echo "[backup] pruning dumps older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cx-*.dump' -mtime "+$RETENTION_DAYS" -print -delete

echo "[backup] done"
