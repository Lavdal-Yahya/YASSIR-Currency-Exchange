> ⚠️ **Draft written blind.** Generated before Phase 2 closed out. This is
> the most dangerous phase in the project — the schema review (P2-13) will
> surface things this document does not anticipate. Refine in the week
> before Phase 3 starts and do not treat any migration or CHECK constraint
> listed here as final until the schema review has signed off on it.

# Phase 3 — The ledger core (Detail)

Scope: tasks P3-01 → P3-12.
Milestone: **v2**.

Goal: currency balances exist, are **derived** from an append-only ledger,
can only change through one code path, survive concurrent writers, and are
proven correct by opening balances — the system's first and safest ledger
writer.

This is the phase where the project stops being safe boilerplate and starts
carrying money. If any of the invariants in `docs/conventions.md` §5 is
soft, they will stay soft — every later phase inherits the ledger's
behaviour. Get this one right or every other DoD is decoration.

---

## 0. Hard gate

Phase 2's DoD must pass in full. Specifically:

- **`docs/schema-review.md` is signed off** — the sign-off checklist at
  the bottom shows two names and a client walkthrough date. If it is not
  signed off, do not start P3-01. The migration file that starts P3 is the
  point of no return; the paper review is the last chance.
- Every raw-SQL constraint enumerated in the schema review is copied into
  P3-01 verbatim. A CHECK on paper is not a CHECK in the database.
- `common/period.ts` reads timezone from `settings`, not from an env var.
- D-016 resolved by D-021 (recompute-and-restate). `CostEngine.replay` in P3-04
  is now on the critical path for trade reversal in P6-04 — build it and test
  its idempotency (P3-04 test list already covers this) knowing that reversal
  leans on it.

---

## 1. PR structure — **mandatory split**

**Two PRs. Not negotiable. See `docs/architecture.md` §3.3.**

- **PR-A — core.** P3-01 → P3-07. Migration, `LedgerService`,
  `CostEngine`, standing invariants wired, service-level tests. **No UI.**
  Reviewer's job is to read one locking transaction with nothing else on
  the page.
- **PR-B — opening balances.** P3-08 → P3-12. Opening currency, debt
  entries; the go-live lock; the opening-balance screens; the
  standalone `check-invariants.ts` script.

The reason for the split is not process. It's that reviewing a 400-line
`FOR UPDATE` transaction inside a 2,000-line PR containing forms and
translations is theatre — the eye tires before it reaches the important
bits.

---

## 2. Migrations

### `20260819_add_ledger_core` (PR-A)

Four tables. The exact column list is dictated by `docs/schema-review.md`
— what follows is the planned skeleton.

| Table | Columns of note |
|---|---|
| `currency_ledger` | id BIGSERIAL PK, `currency_id` UUID FK, `direction` `ledger_direction` enum (`CREDIT`|`DEBIT`), `amount` NUMERIC(24,4), `source_type` TEXT, `source_id` UUID NULL, `payment_method_id` UUID FK NULL (D-020), `transaction_date` TIMESTAMPTZ, `sequence` BIGSERIAL (write-time monotonic), `description` TEXT, `is_active` BOOL DEFAULT true, `note` TEXT NULL, `created_by_user_id` UUID, `created_at` TIMESTAMPTZ |
| `currency_balance` | `currency_id` UUID PK/FK, `cached_amount` NUMERIC(24,4) DEFAULT 0, `updated_at` TIMESTAMPTZ. One row per currency, upserted on first movement. |
| `cost_movement` | id BIGSERIAL PK, `currency_id` UUID FK, `ledger_entry_id` BIGINT FK → `currency_ledger`, `kind` `cost_movement_kind` enum (`ACQUISITION`|`DISPOSAL`), `quantity` NUMERIC(24,4), `unit_cost_mru` NUMERIC(24,8), `realized_pnl_mru` NUMERIC(24,4) NULL, `is_active` BOOL DEFAULT true, `sequence` BIGINT (mirrors ledger sequence), `created_at` |
| `currency_cost` | `currency_id` UUID PK/FK, `cached_avg_mru` NUMERIC(24,8) DEFAULT 0, `cached_quantity` NUMERIC(24,4) DEFAULT 0, `updated_at` |

Hand-added SQL — **all listed in `docs/schema-review.md`**, all pasted
in raw:

- `CHECK (currency_ledger.amount > 0)` — direction carries sign, not
  amount.
- `CHECK (currency_balance.cached_amount >= 0)` on non-base currencies.
  Enforced with a trigger (partial CHECK cannot reference another table).
  The trigger fires `BEFORE INSERT OR UPDATE ON currency_balance` and
  reads `currency.is_active AND NOT is_base`. Schema review resolves the
  exact form.
- `CHECK (cost_movement.quantity > 0)`.
- `CHECK (currency_cost.cached_quantity >= 0)` on non-base currencies.
- Indexes: `currency_ledger(currency_id, sequence)`,
  `currency_ledger(source_type, source_id)`,
  `currency_ledger(transaction_date DESC)`,
  `cost_movement(currency_id, sequence)`.
- `REVOKE DELETE ON currency_ledger, currency_balance, cost_movement,
  currency_cost FROM currency_app;` — the application role has no DELETE.

**Regeneration risk.** Every hand-written SQL statement is dropped
silently on the next `prisma migrate dev`. The pre-commit self-review
checklist (conventions §1 item 6) is the only defence. Eyeball the
generated file before commit.

### `20260819_add_openings` (PR-B)

| Table | Columns |
|---|---|
| `opening_balance` | id UUID PK, `currency_id` FK, `quantity` NUMERIC(24,4), `opening_avg_cost_mru` NUMERIC(24,8), `effective_date` DATE, `created_by_user_id`, `created_at` |
| `receivable` and `payable` (skeleton, no logic yet) | id UUID PK, `contact_id` FK, `currency_id` FK, `original_amount`, `outstanding_amount`, `origin` `debt_origin` enum (`TRADE`|`OPENING`) (D-010), `source_type` TEXT NULL, `source_id` UUID NULL, `status` enum, `created_at`, `updated_at` |

Full lifecycle for `receivable`/`payable` (payment status enum,
settlements) arrives in P5 — but the tables ship now because opening
debts (P3-09) need somewhere to land.

---

## 3. Core services — build first, with tests

### `LedgerService`

Public API, one method:

```ts
LedgerService.apply(
  tx: Prisma.TransactionClient,
  movements: Movement[],
): Promise<LedgerEntry[]>
```

Numbered contract:

1. `tx` is **required**. There is no overload without it. There is no
   non-transactional variant.
2. Sort `movements` by `currencyId` ascending, then `SELECT … FOR UPDATE`
   the corresponding `currency_balance` rows in that order. This is what
   prevents two concurrent trades locking currencies in opposite orders
   and deadlocking on the busiest day of the week.
3. For each currency, compute the resulting balance from `cached_amount +
   Σ credits − Σ debits`. If any non-base currency ends negative and no
   override is present, throw `InsufficientBalanceError` with structured
   data. If the override is present, is owner-only, and targets the base
   currency only (D-015). Non-base override is refused entirely.
4. Insert ledger rows (batch), upsert balance rows (single UPDATE per
   currency), hand each movement to `CostEngine.apply(tx, entry)` in
   ledger sequence order.
5. Return the inserted ledger rows to the caller. Callers store their IDs
   on their own rows (e.g. `purchase.ledger_entry_ids`) for reversal.

**`apply()` is batch-only.** Calling it in a loop inside one business
operation reintroduces exactly the ordering problem the batch form
exists to prevent. A single movement is `apply(tx, [m])`. The
self-review checklist in `docs/conventions.md` §1 lists this.

**The base-leg rule (D-019) is not in `apply()`**. It sits in the trade
services in P4, so that expenses, settlements, and opening balances
(none of which have two legs) can use `LedgerService` unchanged.

Test-level guarantees the service publishes (P3-07):

- Single-movement acquisition writes one ledger row and updates the
  cache.
- Multi-currency batch (two currencies) locks in sorted order.
- Insufficient balance rejection contains structured data
  (`{ available, requested, currencyId }`).
- Owner override accepted for MRU; refused for USD.
- **Concurrent test**: two connections spending the same USD balance,
  one loses. Runs against real Postgres via a real `$transaction` in a
  parallel Promise.
- A mid-transaction failure (e.g. cost engine throws) leaves no partial
  ledger row.

### `CostEngine`

Public API:

```ts
CostEngine.apply(tx, ledgerEntry): void   // during LedgerService.apply
CostEngine.replay(tx, currencyId): void    // used in reversal (P6-04)
```

Numbered contract:

1. **Acquisition** (credit on any currency): quantity added at
   `unit_cost_mru`, which is derived from the transaction's MRU leg.
   For a purchase of X USD paid Y MRU, the acquisition of USD is at
   `Y / X`. For an opening balance (P3-08) it is the operator-supplied
   `opening_avg_cost_mru`. **MRU itself has a fixed unit cost of 1.00
   and never registers realized P&L** (D-006).
2. **Disposal** (debit on a non-base currency): quantity subtracted at
   the current weighted average; `realized_pnl_mru` computed as
   `(disposal_value_at_current_rate − disposal_quantity × avg_cost)`.
3. Movements are ordered by **ledger `sequence`**, never by
   `transaction_date`. Backdating (spec §9.2) is legal but must not
   retroactively rewrite closed periods. See D-008.
4. The cache (`currency_cost.cached_avg_mru`) is updated after each
   movement. A standing invariant (INV-4) asserts on every test run that
   the cache equals a full replay.
5. `replay()` recomputes forward from scratch, ignoring `is_active =
   false` rows. Used by reversal. Idempotent.

Tests:

- Two purchases of USD at different rates → the third disposal at the
  weighted average (the classic worked example — pin it as a fixture).
- Backdated purchase does not rewrite prior sale's `realized_pnl_mru`.
- MRU disposal produces `realized_pnl_mru = 0`.
- `replay()` for a currency with N movements gives the same
  `cached_avg_mru` as walking `apply()` incrementally.

### Read APIs (P3-05)

- `GET /api/v1/balances` → list of `{ currencyId, code, cachedAmount,
  lastMovementAt, cachedAvgMru }` for active currencies.
- `GET /api/v1/balances/:currencyId` → single-currency detail.
- `GET /api/v1/ledger?currencyId=…&from=…&to=…` — paginated, filter
  by active only unless `?includeInactive=true` and caller has audit
  permission.

Reports and dashboards in P7 read from these; opening-balance screens
in P3-11 read from them.

### Standing invariants (P3-06)

Written as functions in `api/src/common/invariants.ts`, each returning
`string[]` of failures for the currencies/entities that break.
`api/scripts/check-invariants.ts` (P3-12) is the CLI wrapper.

`api/test/setup-invariants.ts` wires the applicable ones into the
integration suite's global `afterEach`:

| ID | Applicable in P3? |
|---|---|
| INV-1 | Yes — sum of active credits − debits = `cached_amount` |
| INV-4 | Yes — `currency_cost.cached_avg` = replay |
| INV-6 | Yes — every ledger entry has an active source, and vice versa. In P3 the only source is `OPENING`; guard the query for it. |
| INV-8 | Yes — no non-base negative balance |
| INV-9 | Yes — every cash-movement ledger entry has a `payment_method_id`; entries on `requires_note` methods have a non-empty note. In P3 the only writers of cash movements are opening entries; guard for them. |
| INV-2, INV-3, INV-5 | Not yet — receivable/payable have skeletons but no allocations. Wire in P5. |
| INV-7 | Not yet — no purchase/sale rows. Wire in P4. |

---

## 4. Endpoints

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/balances` | `balance:read` |
| GET | `/api/v1/balances/:currencyId` | `balance:read` |
| GET | `/api/v1/ledger` | `ledger:read` |
| POST | `/api/v1/openings/currency` | `opening:manage` |
| POST | `/api/v1/openings/debt` | `opening:manage` |
| GET | `/api/v1/openings` | `opening:read` |
| PATCH | `/api/v1/openings/:id` | `opening:manage`, refused after go-live unless caller has `opening:adjust_post_golive` (owner-only) |

The go-live lock (P3-10) applies to PATCH only. Once `settings.go_live_at`
is non-null, POST of new openings returns 422
`OpeningAfterGoLiveError` — new positions after go-live are trades or
adjustments, not openings.

---

## 5. Frontend (PR-B only)

Routes:

```
/openings                     OpeningsHomePage (list of currencies with opening state, + debts)
/openings/currency/new        OpeningCurrencyFormPage
/openings/debt/new            OpeningDebtFormPage
/balances                     BalancesDashboardPage (uses cached read API)
```

Components:

- `OpeningCurrencyForm` — quantity + opening average cost + effective
  date. Explicit warning: "This creates a ledger entry. Correcting it
  after go-live requires an owner adjustment."
- `OpeningDebtForm` — contact picker (from P2 CRUD), currency picker,
  amount, side (receivable or payable). Reuses the empty-tab
  placeholders now that debts exist as rows (even without allocations).
- `BalancesCard` — per-currency card with amount, code, last movement
  date, and a low-balance chip when under `low_balance_threshold`.
- `GoLiveLockNotice` — a banner shown on the openings screens once
  `go_live_at` is set. Explains why the form is read-only.

Cache keys: `['balances']`, `['ledger', filters]`, `['openings']`.

`OfflineBanner` from P1-15 continues; **write-blocking arrives with the
first mutating form in P4**, per the P1 explicit-deferred note.
Openings are entered on desktop in a controlled setting, not from a
phone in the field — deferring blocking is defensible.

---

## 6. Tests

Integration, real Postgres. Priority order — concurrency first because
concurrency tests are the ones people skip when the sprint gets tight.

1. **P3-07** Concurrent spend on same currency, one wins one loses.
2. **P3-02** Single acquisition and disposal end-to-end via `apply()`;
   the ledger rows, balance, and cost cache are consistent by direct
   query.
3. **P3-02** Multi-currency batch (`apply(tx, [movementUsd,
   movementMru])`) writes both, locks in sorted order (verified with a
   query against `pg_locks` inside the tx if practical, otherwise
   trust the sort and add a review comment).
4. **P3-03** Insufficient balance rejection carries `{ currencyId,
   available, requested }`.
5. **P3-03** Negative-balance override accepted for MRU when caller has
   the permission; refused for USD; refused for anyone without.
6. **P3-04** Cost engine — two purchases at different rates, third
   disposal at the weighted average matches a hand-computed figure.
7. **P3-04** Backdated purchase does not change prior sale's realized
   P&L.
8. **P3-04** `CostEngine.replay()` matches incremental `apply()` for a
   fixture with 10 movements.
9. **P3-07** Mid-transaction failure (cost engine throws) leaves no
   ledger row.
10. **P3-06** Standing invariants pass after every test in the suite.
11. **P3-10** POSTing a new opening after `go_live_at` returns 422.
12. **P3-08** An opening currency balance flows through `apply()` — the
    ledger row exists, balance matches, cost cache is set. Verified by
    query, **not** by reading the UI (per the DoD).
13. **P3-11** UI: opening screens are read-only when `go_live_at` is
    non-null (component test).

---

## 7. Definition of Done — checklist

- [ ] `grep -R "currency_ledger\|currency_balance\|cost_movement\|
      currency_cost" api/src/ api/prisma/` — every write site is inside
      `LedgerService` or `CostEngine`. Grep pattern **includes raw SQL and
      snake_case** (Prisma uses camelCase, raw uses snake_case). The
      grep output is pasted into PR-A's description.
- [ ] Two concurrent HTTP requests spending the same USD balance leave
      the balance correct and exactly one request rejected. Test log
      pasted into the PR.
- [ ] Standing invariants INV-1, INV-4, INV-6, INV-8, INV-9 pass in
      every test in the suite (verified by adding a deliberately broken
      row to a scratch DB and confirming a red run).
- [ ] `UPDATE currency_balance SET cached_amount = -1 WHERE currency_id =
      '<usd-uuid>';` executed by hand is refused by the database (trigger
      or CHECK), not just by the service. Screenshot into PR-A.
- [ ] `REVOKE DELETE` grants are present — verified with
      `\dp currency_ledger` in psql. Screenshot into PR-A.
- [ ] Opening balances entered on the UI match the ledger sum read
      directly from `currency_ledger` by query. Match to the minor unit.
- [ ] After go-live, POSTing a new opening returns 422; PATCHing an
      existing opening returns 422 unless the caller has
      `opening:adjust_post_golive`.
- [ ] `api/scripts/check-invariants.ts --database-url=<url>` runs
      standalone against any database and prints `OK` or the list of
      failing entities.
- [ ] Self-review checklist (conventions §1) walked and every box ticked
      in the PR description.

---

## 8. Explicitly deferred

- **Purchases and sales** — Phase 4. Skeleton `receivable`/`payable`
  tables exist but no `PurchaseService` or `SaleService`.
- **Payments and allocations** — Phase 5. `receivable`/`payable` have no
  lifecycle transitions yet.
- **INV-2, INV-3, INV-5, INV-7** — wired when the tables they target
  gain real data.
- **Reversal** — Phase 6. `is_active = false` exists as a column but no
  code sets it in P3.
- **Offline write-blocking** — the banner is still banner-only; the
  first mutating form is P4, and blocking lands with it.
- **Reports and dashboards** — Phase 7. `BalancesDashboardPage` in P3-11
  is a single card grid, not the P7 dashboard.
- **Rate snapshots** — Phase 8. Opening cost is operator-supplied, not
  looked up.
- **Cross-currency debt settlement** — never (spec §15.2 forbids it).
- **`payment_base_rate`** — never (D-019 removed it).
