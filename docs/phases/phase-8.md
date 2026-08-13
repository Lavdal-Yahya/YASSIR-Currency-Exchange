> **Status: shipped 2026-08-13** via `feat/phase-8`. All eleven DoD boxes green,
> 199/199 integration tests, chokepoint grep clean. Rate snapshot pipeline
> live (schema, service, cron, UI suggestion + history), plus
> `api/scripts/backup.sh` and `api/scripts/restore-rehearsal.sh` with
> `docs/ops/backup-restore.md`. Restore rehearsal end-to-end proven against
> the local test DB via the docker postgres client.

# Phase 8 — Rate snapshots + backup rehearsal (Detail)

Scope: tasks P8-01 → P8-06.
Milestone: **v5** — the operator sees an informational market-rate label
when entering a trade, and the backup/restore path has been rehearsed
against a scratch database.

Goal: give the operator a *suggestion* — never an override — of the
current market rate for each non-base currency, and prove that our
backups can actually be restored.

Rate snapshots are **non-authoritative**. No trade math ever reads them
(spec §21.2, D-007 superseded). They power:
1. a "suggested rate" chip on the purchase/sale form,
2. a small rate-history view for the owner.

The stored `rate` on a purchase/sale never changes when a snapshot
refreshes — that would violate the immutability rule in
architecture §3.6.

---

## 0. Hard gate

Phase 7's DoD must pass:

- Dashboard summary + cash-flow + ageing endpoints green.
- 188/188 integration tests + chokepoint grep clean.
- `feat/phase-7` squash-merged to `main`. (**Done 2026-08-13.**)

---

## 1. PR structure

One branch (`feat/phase-8`), one PR. The rate module is a self-contained
read-mostly slice; the backup scripts are shell tooling with no
production side effects.

---

## 2. Migrations

### `20261028_add_rate_snapshots`

Per schema-review §6.1:

- `rate_snapshot` table with `id BIGSERIAL`, `currency_id UUID NOT NULL FK`,
  `mid_rate_mru NUMERIC(24,8) NOT NULL`, `source TEXT NOT NULL`,
  `fetched_at TIMESTAMPTZ NOT NULL`, `is_current BOOL DEFAULT true`.
- CHECK constraint `mid_rate_mru > 0`.
- Partial unique index `(currency_id) WHERE is_current = true` — only
  one current row per currency at any moment.
- Regular index `(currency_id, fetched_at DESC)` for history reads.
- `REVOKE DELETE … FROM currency_app` (guarded).

No change to any other table. Rate snapshots do not participate in the
ledger; they never affect balances or costs.

---

## 3. Core services

### `RateProvider` (interface, P8-01)

Pluggable so a test can inject a deterministic provider and the prod
build can swap the source when the free tier changes shape:

```ts
export interface RateProvider {
  readonly name: string;
  fetch(baseCode: string, targetCodes: string[]):
    Promise<Array<{ code: string; midRateMru: Decimal }>>;
}
```

**Default implementation:** `OpenErApiProvider` — hits
`https://open.er-api.com/v6/latest/{baseCode}` (free, no key). Returns
`{ code, midRateMru }` for every target currency present in the
response. If the fetch fails or a target code is missing, that currency
is **silently omitted** — this is a suggestion feed, not authoritative
data. A missing rate leaves the previous snapshot in place.

**Test implementation:** `FixedRateProvider` — returns a hardcoded
Map<code, Decimal> passed at construction. Used everywhere in tests so
they never hit the network.

### `RateService` (P8-02)

Public methods:

- `refresh(): Promise<{ refreshed: number; failed: number }>` — for every
  active non-base currency, ask the provider, and on success:
  1. flip the existing `is_current = true` row (if any) to `false`,
  2. insert a new row with `is_current = true`.
  Wrapped in a single `$transaction` per currency (three currencies →
  three transactions — no shared locking, so a stuck provider on one
  currency doesn't block the others).
- `current(): Promise<Array<CurrentRateRow>>` — reads `is_current = true`
  rows, joined against currency.
- `history(currencyId, limit): Promise<Array<RateSnapshot>>` — most
  recent `limit` snapshots for one currency, ordered by `fetched_at DESC`.

### `RateRefreshScheduler` (P8-03)

Uses `@nestjs/schedule`'s `@Cron` decorator. Fires once daily at 06:00
local time. Wraps `RateService.refresh()` in a try/catch and logs the
result — never throws (a cron failure must not crash the process).

The schedule is inactive during tests via `NODE_ENV === 'test'` guard.

---

## 4. Endpoints

New routes on `RateController` under `/rates`:

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/rates` | `rate:read` | Current snapshot per active non-base currency. |
| GET | `/api/v1/rates/history` | `rate:read` | Query: `currencyId`, `limit` (default 30, max 200). |
| POST | `/api/v1/rates/refresh` | `rate:manage` | Owner-only manual trigger. |

`rate:read` is in `EMPLOYEE_PERMISSIONS` — the operator needs to see the
suggested rate. `rate:manage` (already in permissions.ts, owner-only)
gates the manual refresh so a compromised employee session can't hammer
the external API.

---

## 5. Frontend

### Rate suggestion chip on trade forms (P8-05)

Both `PurchaseFormPage` and `SaleFormPage` add an inline "Suggested"
chip next to the rate input, showing `midRateMru` for the selected
non-base leg's currency. Clicking the chip fills the input.

The chip is a courtesy — it never *validates* the operator's typed
rate (spec §21.2). A big mismatch between chip and typed value is not
an error. The operator is authoritative.

### Rate history page (P8-05)

`/rates` — a simple table: one section per non-base currency, listing
`fetched_at DESC` snapshots. Owner-facing (rate:read → employees see it
too, but this page is a small admin view; no dashboard link for
employees).

Cache keys: `['rates', 'current']`, `['rates', 'history', currencyId]`.

### i18n

New keys in AR + FR:
- `rates.title`, `rates.current`, `rates.history`, `rates.fetched_at`,
  `rates.source`, `rates.mid_rate`, `rates.refresh`, `rates.refresh_started`,
  `rates.suggested_rate`, `rates.no_snapshot`

---

## 6. Backup + restore rehearsal (P8-06)

Two shell scripts under `api/scripts/`:

### `backup.sh`
Runs `pg_dump --format=custom --compress=9 --no-owner --no-privileges
--exclude-schema=_prisma_migrations` against `$DATABASE_URL`, writes to
`$BACKUP_DIR/cx-YYYY-MM-DD-HHMM.dump`, and prunes files older than
`$RETENTION_DAYS` (default 30). Prints one line per action for cron
mail.

### `restore-rehearsal.sh`
The DoD from architecture §7. Takes a dump file path, restores it into
a scratch database `${DATABASE_URL}_rehearsal`, runs
`check-invariants.ts` against the restored DB, and prints OK or the
failing invariant. Uses `pg_restore --clean --if-exists`. Drops the
scratch DB on success (kept on failure for inspection).

### Docs

`docs/ops/backup-restore.md` — one page:
- How to run the backup manually (`./api/scripts/backup.sh`).
- Where cron should be installed (production compose has no cron
  container yet — deferred; ops team runs it via host crontab for
  now).
- How to run the rehearsal (`./api/scripts/restore-rehearsal.sh
  /path/to/dump`).
- The rule: **rehearse quarterly**, not just when someone remembers.

Scripts run in dev against the test DB in this session; production
scheduling is left to the ops team on the VPS.

---

## 7. Tests

Integration tests in `api/test/integration/rates.integration.test.ts`:

1. **P8-02 fetch and store** — with `FixedRateProvider` returning
   `{ USD: 40.5, EUR: 43.2 }`, call `RateService.refresh()` and assert
   exactly one `is_current = true` row per currency, with the expected
   `mid_rate_mru`.
2. **P8-02 second refresh flips the flag** — call refresh again with
   different values, assert the old row is now `is_current = false`
   and the new row is current. Partial unique index proves it (a
   direct SQL insert of a second current row for the same currency
   must fail).
3. **P8-02 skip base currency** — MRU never gets a snapshot (rate = 1
   by definition, D-006). Refresh with an empty response for MRU is
   a no-op.
4. **P8-02 provider failure is silent per-currency** — `FailingProvider`
   throws for USD but returns 43.2 for EUR. Refresh returns
   `{ refreshed: 1, failed: 1 }`; EUR gets a new snapshot, USD keeps
   its previous one (or has none).
5. **P8-03 current endpoint** — `GET /rates` returns exactly one row
   per non-base currency, employee can call it.
6. **P8-03 history endpoint** — seed three snapshots for USD, assert
   `GET /rates/history?currencyId=USD&limit=2` returns two most-recent
   rows sorted DESC.
7. **P8-03 refresh permission** — `POST /rates/refresh` returns 403 to
   employee, 200 to owner.
8. **P8-04 rate never modifies a trade** — reversal grep guard: no
   file in `rates/` writes to `purchase`, `sale`, `payment`, `expense`,
   `currency_ledger`, `currency_balance`, `cost_movement`, or
   `currency_cost`.

---

## 8. Definition of Done — checklist

- [x] `20261028_add_rate_snapshots` migration checked in, partial
      unique index verified by a duplicate-insert test.
- [x] `RateService.refresh()` produces exactly one `is_current = true`
      row per active non-base currency after each run (§7.1, §7.2).
- [x] Base currency (MRU) never has a snapshot row (§7.3).
- [x] Provider failures are per-currency; a bad USD fetch does not
      block EUR (§7.4).
- [x] `POST /rates/refresh` is owner-only; `GET /rates` and
      `/rates/history` are employee-accessible (§7.5, §7.7).
- [x] Rate module writes to no financial table (rule 1, conventions §8).
      Grep guard in §7.8.
- [x] Chokepoint grep clean.
- [x] Backup script produces a `.dump` file that `pg_restore` reads
      without errors.
- [x] Restore rehearsal script runs end-to-end: dump → restore into
      scratch DB → invariants → drop scratch DB. Prints OK.
- [x] `docs/ops/backup-restore.md` explains how to run both, and the
      rehearse-quarterly rule.
- [x] Both AR and FR i18n keys present for rate chip + history page.

---

## 9. Explicitly deferred

- **Live cron on the VPS** — `RateRefreshScheduler` runs in-process via
  `@nestjs/schedule`. Wiring a host crontab or a separate cron
  container on the VPS is an ops step, not a code change.
- **Rate alerts** — no notification when a rate moves more than X%.
- **Multiple providers with fallback** — one provider for now.
  `RateProvider` interface makes adding a second trivial when needed.
- **Rate history chart** — the history page is a table. Chart is a
  UX pass, not blocker.
- **Backup encryption / off-site upload** — scripted, but the upload
  destination (S3, borg, rsync target) is not chosen in scope.
- **Automated restore rehearsal in CI** — the rehearsal script is
  runnable but not wired into GitHub Actions. Would need a Postgres
  service container and a real dump fixture.
- **Live-VPS deployment verification** — the prod compose file already
  exists (P1-16). Executing a deploy needs shell on the server.
