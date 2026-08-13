# Backup & restore

Two scripts under `api/scripts/`:

- **`backup.sh`** — nightly `pg_dump` into `$BACKUP_DIR`, prunes files older
  than `$RETENTION_DAYS` (default 30).
- **`restore-rehearsal.sh`** — restores a dump into a scratch DB, runs
  `check-invariants.ts`, drops the scratch DB on success. This is the
  architecture §7 DoD: **a backup that has never been restored is not
  a backup.**

Both operate on `$DATABASE_URL`; both require `pg_dump` / `pg_restore`
/ `psql` on `PATH` (the `postgres:16-alpine` client image provides
them if the host doesn't).

---

## Running the backup manually

```bash
DATABASE_URL='postgresql://user:pass@host:5432/currency_exchange' \
  BACKUP_DIR=/srv/cx/backups \
  RETENTION_DAYS=30 \
  ./api/scripts/backup.sh
```

Output:

```
[backup] 2026-08-13T03:00:01+00:00 writing /srv/cx/backups/cx-2026-08-13-0300.dump
[backup] wrote 8234512 bytes
[backup] pruning dumps older than 30 days
[backup] done
```

Environment defaults if unset:
- `BACKUP_DIR=./backups`
- `RETENTION_DAYS=30`

---

## Scheduling

**Not scheduled in-app yet.** The production compose file doesn't ship a
cron container; the ops team installs a host crontab entry against the
mounted backup volume:

```cron
0 3 * * *  cd /opt/cx && DATABASE_URL=... BACKUP_DIR=/srv/cx/backups ./api/scripts/backup.sh >> /var/log/cx-backup.log 2>&1
```

Adding a cron sidecar in `docker-compose.prod.yml` is a follow-up when
we have more than one thing that needs scheduling.

---

## Running the restore rehearsal

```bash
DATABASE_URL='postgresql://user:pass@host:5432/currency_exchange' \
  ./api/scripts/restore-rehearsal.sh /srv/cx/backups/cx-2026-08-13-0300.dump
```

What it does:
1. Parses `DATABASE_URL` and creates a scratch DB named
   `<db>_rehearsal` on the same server.
2. `pg_restore --clean --if-exists` into the scratch DB.
3. Runs `check-invariants.ts` against the scratch DB. That checker
   verifies INV-1..INV-9 (balance = ledger sum, WAC = cost replay,
   outstanding = original − active allocations, and the rest).
4. On success, drops the scratch DB and prints `[rehearsal] OK`.
5. On failure, the scratch DB is kept for inspection unless
   `KEEP_SCRATCH=0`.

Set `KEEP_SCRATCH=1` to keep it either way.

Output on success:

```
[rehearsal] 2026-08-13T03:15:22+00:00 creating scratch DB currency_exchange_rehearsal
[rehearsal] restoring /srv/cx/backups/cx-2026-08-13-0300.dump
[rehearsal] running check-invariants against currency_exchange_rehearsal
[invariants] OK
[rehearsal] OK
[rehearsal] dropping scratch DB currency_exchange_rehearsal
```

---

## The rule: rehearse quarterly

Schedule a calendar reminder for the *first Monday of the quarter*.
Pick the most recent nightly dump, run `restore-rehearsal.sh`, save
the output as `docs/ops/rehearsals/YYYY-QN.txt`. Ten minutes of work,
and it catches the ways a backup can be silently broken:

- `pg_dump` succeeded but the dump file is truncated (disk full).
- `pg_dump` succeeded but a schema change made restore incompatible.
- Data drift a migration should have caught didn't — the invariants
  fail on restore before they fail on production.

If a rehearsal fails, the last-known-good dump becomes the new "most
recent good backup" and you have to figure out why *the newer ones*
went bad. That is the correct moment to find out — not the moment the
production database is on fire.
