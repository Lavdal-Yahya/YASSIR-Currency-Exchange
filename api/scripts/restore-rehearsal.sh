#!/usr/bin/env bash
# P8-06 · restore rehearsal — the architecture §7 DoD item.
#
# Restores a dump into a scratch database, runs the invariant checker,
# and drops the scratch DB on success (kept on failure for inspection).
# Prints OK or the failing invariant.
#
# Usage:
#   ./api/scripts/restore-rehearsal.sh /path/to/cx-2026-08-13-0300.dump
#
# Requires DATABASE_URL to point at the *live* DB (only its host/port/
# credentials are used — no DDL is run against it). The scratch DB is
# named `${DATABASE_URL basename}_rehearsal` and dropped at the end.
#
# The invariant checker is api/scripts/check-invariants.ts. It exits
# non-zero when any of INV-1..INV-9 fails on the restored data.

set -euo pipefail

DUMP="${1:?usage: restore-rehearsal.sh <dump-file>}"
: "${DATABASE_URL:?DATABASE_URL is required}"

if [ ! -f "$DUMP" ]; then
    echo "[rehearsal] dump not found: $DUMP" >&2
    exit 1
fi

# Parse the URL to extract the parts we need. Bash regex is fine for
# postgres:// URLs; a stray character would fail the checker anyway.
if [[ ! "$DATABASE_URL" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):?([0-9]*)/([^?]+) ]]; then
    echo "[rehearsal] cannot parse DATABASE_URL" >&2
    exit 1
fi
DB_USER="${BASH_REMATCH[2]}"
DB_PASS="${BASH_REMATCH[3]}"
DB_HOST="${BASH_REMATCH[4]}"
DB_PORT="${BASH_REMATCH[5]:-5432}"
DB_NAME="${BASH_REMATCH[6]}"

SCRATCH_DB="${DB_NAME}_rehearsal"
SCRATCH_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${SCRATCH_DB}"

export PGPASSWORD="$DB_PASS"

cleanup() {
    if [ "${KEEP_SCRATCH:-0}" = "1" ]; then
        echo "[rehearsal] KEEP_SCRATCH=1 — leaving $SCRATCH_DB in place"
        return
    fi
    echo "[rehearsal] dropping scratch DB $SCRATCH_DB"
    psql "postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/postgres" \
        -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null
}

echo "[rehearsal] $(date -Iseconds) creating scratch DB $SCRATCH_DB"
psql "postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/postgres" \
    -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null
psql "postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/postgres" \
    -c "CREATE DATABASE \"$SCRATCH_DB\";" >/dev/null

trap cleanup EXIT

echo "[rehearsal] restoring $DUMP"
pg_restore \
    --clean --if-exists \
    --no-owner --no-privileges \
    --dbname="$SCRATCH_URL" \
    "$DUMP"

echo "[rehearsal] running check-invariants against $SCRATCH_DB"
cd "$(dirname "$0")/.."
DATABASE_URL="$SCRATCH_URL" npx tsx scripts/check-invariants.ts

echo "[rehearsal] OK"
