# Schema Review — the gate to v2

Status: **Signed off 2026-08-04.**
Owner: engineering (author) + one second reviewer + the client.
Produced by: **P2-13**.
Unblocks: **P3-01** (the first financial migration).

> ⚠️ **This document is the point of no return before money flows.**
> Once `20260819_add_ledger_core` merges, its column shapes and CHECK
> constraints become permanent — a NUMERIC(24,4) that should have been
> NUMERIC(24,8) is not "fixable in a follow-up", it is a data migration
> in production. The paper form of this review is what forces us to
> read Prisma models next to `docs/architecture.md` §5 (invariants) and
> catch a mistake **before** it exists in migration SQL.

---

## Table of contents

1. [Preamble & scope](#1-preamble--scope)
2. [P3 · ledger core](#2-p3--ledger-core) — `currency_ledger`, `currency_balance`, `cost_movement`, `currency_cost`
3. [P3 · openings + debt skeleton](#3-p3--openings--debt-skeleton) — `opening_balance`, `receivable`, `payable`
4. [P4 · trades](#4-p4--trades) — `purchase`, `sale`
5. [P5 · settlements + expenses](#5-p5--settlements--expenses) — `payment`, `allocation`, `expense`
6. [P8 · rate snapshots](#6-p8--rate-snapshots) — `rate_snapshot`
7. [Raw-SQL constraints — the full checklist](#7-raw-sql-constraints--the-full-checklist)
8. [Deviations from the spec](#8-deviations-from-the-spec)
9. [Open questions](#9-open-questions)
10. [Sign-off](#10-sign-off)

---

## 1. Preamble & scope

**What this document is.** A paper walk-through of every table the
system will grow through Phase 8, laid out with columns, types,
nullability, indexes, and foreign keys, next to the raw-SQL constraints
that Prisma cannot express and must be pasted verbatim into the
migration that introduces the table. Every deviation from
`docs/architecture.md` §5 or the delivered spec is cross-referenced to a
decisions-log entry (D-0xx); anything without such a reference is flagged
in §9 for closure before P3-01 opens.

**What this document is not.** Not a Prisma schema (the models will be
written from this doc, not the other way round). Not an ORM tutorial.
Not a place for endpoint or service design — those belong in the phase
docs.

**Scope.** Tables that will exist by the end of Phase 8, minus the
already-migrated master data (currency, contact, expense_category,
payment_method, settings, plus the P1 auth tables). Everything covered
here **does not** exist in the database yet: `ls
api/prisma/migrations/` today shows no financial migrations, and the
P2 DoD asserts this.

**Convention.** Types use PostgreSQL notation; nullability is called
out explicitly as `NULL` or `NOT NULL`; `TIMESTAMPTZ(6)` is the
project-wide timestamp type (microsecond precision — D-002 does not apply
to timestamps, only to money). Primary keys are UUID unless flagged.
Money is `NUMERIC(24,4)`, rates are `NUMERIC(24,8)` (D-002). BIGSERIAL
is used for the ledger sequence.

---

## 2. P3 · ledger core

Migration file: `20260819_add_ledger_core`. Ships as PR-A of Phase 3
(no UI, one focused review — `docs/architecture.md` §3.3).

### 2.1 `currency_ledger`

Append-only. Every currency movement in the system's lifetime lives
here as one row. Nothing else may write balances. See D-003 + D-004.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | BIGSERIAL PK | NOT NULL | BIGINT because we expect > 2^31 rows over the system's lifetime. |
| `currency_id` | UUID | NOT NULL | FK → `currency.id` ON DELETE RESTRICT. |
| `direction` | `ledger_direction` enum (`CREDIT`, `DEBIT`) | NOT NULL | Sign lives here, not on `amount`. Simplifies index-only aggregation. |
| `amount` | NUMERIC(24,4) | NOT NULL | Always > 0. Direction carries sign. |
| `source_type` | TEXT | NOT NULL | Discriminator. In P3: `'opening_balance'`. From P4: `'purchase'`, `'sale'`. From P5: `'payment'`, `'expense'`. Free-form to avoid an ever-growing enum migration; validated per phase in the service layer. |
| `source_id` | UUID | NULL | Points at the source row. NULL is allowed only for openings — every trade/payment/expense row **must** be linked (checked in a partial CHECK, see §7). |
| `payment_method_id` | UUID | NULL | FK → `payment_method.id` ON DELETE RESTRICT. Required when `source_type IN ('payment', 'expense')` **and** on the immediate-payment leg of `purchase` / `sale` when `immediate_payment > 0`. NULL on the delivered leg of a trade (D-020, `docs/architecture.md` §3.6). |
| `note` | TEXT | NULL | Free-text note associated with the payment method. Required when the linked payment method has `requires_note = true`. Enforced in `LedgerService.apply` (D-020). |
| `transaction_date` | TIMESTAMPTZ(6) | NOT NULL | Operator-provided. `period.startOfPeriod` is computed against this, not `created_at`. |
| `sequence` | BIGINT | NOT NULL | Monotonic write-time sequence. Not the PK because the PK is `id`; `sequence` is what `cost_movement.sequence` mirrors so `CostEngine.replay` is deterministic. Filled from a dedicated Postgres sequence, not `id`, so a future partitioning of `currency_ledger` doesn't break replay. |
| `description` | TEXT | NOT NULL | Human string, i18n-neutral (English internal). Not shown to users directly — the UI renders from `source_type` + linked row. |
| `is_active` | BOOL DEFAULT true | NOT NULL | Set to `false` when the movement is reversed (D-021). Balance recomputation ignores `false` rows. **Never deleted.** |
| `created_by_user_id` | UUID | NOT NULL | FK → `user.id` ON DELETE RESTRICT. |
| `created_at` | TIMESTAMPTZ(6) DEFAULT now() | NOT NULL | Wall clock, for audit. |

**Indexes.**

- Primary: `id`.
- `currency_ledger(currency_id, sequence)` — the standard read pattern for balance recomputation and CostEngine replay.
- `currency_ledger(source_type, source_id)` — reverse lookup ("which movements did this purchase produce?"). Includes NULL `source_id` rows for openings — a partial index excluding NULL is not worth the complexity.
- `currency_ledger(transaction_date DESC)` — history views (P3-11).
- `currency_ledger(created_by_user_id, created_at DESC)` — per-operator audit views.

**Foreign keys.** `currency_id`, `payment_method_id`, `created_by_user_id` — all `ON DELETE RESTRICT`. Even the `REVOKE DELETE` at the app-role level (see §7) is a belt-and-braces; the FK is the DB-level guarantee.

**No FK from `source_id` to a specific table** because the column is polymorphic. Referential integrity for `source_type='purchase'`, etc., is enforced by application-level tests (`docs/architecture.md` §5 INV-3).

### 2.2 `currency_balance`

Cache row per currency. Truth is `SUM(currency_ledger)`; this exists so the dashboard doesn't do the sum on every read (D-003).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `currency_id` | UUID PK/FK | NOT NULL | FK → `currency.id` ON DELETE RESTRICT. One row per currency. |
| `cached_amount` | NUMERIC(24,4) DEFAULT 0 | NOT NULL | Reconciled to the ledger sum by INV-1 on every test run and by the standalone `check-invariants.ts` script (P3-12). |
| `updated_at` | TIMESTAMPTZ(6) | NOT NULL | Updated inside every `LedgerService.apply` transaction. |

Upserted on first movement (no seed row). Concurrent writers coordinate via `SELECT … FOR UPDATE` on this row inside `LedgerService.apply`, so `cached_amount` is always consistent within a transaction. See §7 for the `>= 0` constraint on non-base currencies.

### 2.3 `cost_movement`

Per-currency running cost basis (WAC). One row per `currency_ledger` movement that affects cost — every credit is an `ACQUISITION`, every debit is a `DISPOSAL`. Realized P&L is computed on disposals against the current WAC and persisted here (not derived on the fly).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | BIGSERIAL PK | NOT NULL | |
| `currency_id` | UUID | NOT NULL | FK → `currency.id` ON DELETE RESTRICT. |
| `ledger_entry_id` | BIGINT | NOT NULL | FK → `currency_ledger.id` ON DELETE RESTRICT. Unique — every ledger row produces at most one cost row. |
| `kind` | `cost_movement_kind` enum (`ACQUISITION`, `DISPOSAL`) | NOT NULL | Redundant with the linked ledger row's `direction`, kept here so `CostEngine.replay` reads one table. |
| `quantity` | NUMERIC(24,4) | NOT NULL | Same as ledger row's `amount`; copied for the same reason as `kind`. |
| `unit_cost_mru` | NUMERIC(24,8) | NOT NULL | The MRU cost per one unit of the currency at the time of this movement. For an acquisition, this is the effective rate (payment_MRU / delivered_qty). For a disposal, this is the WAC **before** this row applied. |
| `realized_pnl_mru` | NUMERIC(24,4) | NULL | Non-NULL on disposals only. Signed. Computed as `(sale_unit_price − wac_before) × quantity`. |
| `is_active` | BOOL DEFAULT true | NOT NULL | Flipped to false on reversal (D-021), same rule as the ledger. |
| `sequence` | BIGINT | NOT NULL | Mirrors the linked ledger row's `sequence`. Replaying is `ORDER BY sequence ASC`. |
| `created_at` | TIMESTAMPTZ(6) DEFAULT now() | NOT NULL | |

**Indexes.** Primary `id`; `(currency_id, sequence)` for replay; `(ledger_entry_id)` unique so a reversal can find the row deterministically.

### 2.4 `currency_cost`

Cache of the current WAC per currency. One row per currency, kept next to the ledger cache. Same INV-2 as balance: it must equal the running WAC computed from all active `cost_movement` rows for that currency.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `currency_id` | UUID PK/FK | NOT NULL | FK → `currency.id` ON DELETE RESTRICT. |
| `cached_avg_mru` | NUMERIC(24,8) DEFAULT 0 | NOT NULL | 8dp because rate math accumulates precision. |
| `cached_quantity` | NUMERIC(24,4) DEFAULT 0 | NOT NULL | Copy of the currency's current holding; used to detect a "zero holdings" state where the WAC is reset. |
| `updated_at` | TIMESTAMPTZ(6) | NOT NULL | |

For the base currency (MRU), `cached_avg_mru` is always `1.00000000`. The CostEngine skips the base currency entirely.

---

## 3. P3 · openings + debt skeleton

Migration file: `20260819_add_openings`. Ships as PR-B of Phase 3.

### 3.1 `opening_balance`

Written exactly once per currency during pre-go-live. Immutable after `settings.go_live_at` is set (P3-10). Each row produces exactly one `currency_ledger` credit and one `cost_movement` acquisition on write.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | NOT NULL | |
| `currency_id` | UUID | NOT NULL | FK → `currency.id` ON DELETE RESTRICT. Unique — one opening per currency. |
| `quantity` | NUMERIC(24,4) | NOT NULL | > 0 (see §7). |
| `opening_avg_cost_mru` | NUMERIC(24,8) | NOT NULL | > 0. The "we bought these dollars for X MRU per unit historically" number, provided at go-live. |
| `effective_date` | DATE | NOT NULL | Business date the balance is as of. Distinct from `transaction_date` on the ledger, which is the operator's clock reading. |
| `created_by_user_id` | UUID | NOT NULL | FK → `user.id` ON DELETE RESTRICT. |
| `created_at` | TIMESTAMPTZ(6) DEFAULT now() | NOT NULL | |

**Indexes.** Primary `id`; unique `(currency_id)`.

### 3.2 `receivable` and `payable` (skeleton)

Ships in P3 as **skeleton only** so opening debts have somewhere to land (P3-09). Full lifecycle (`payment_status` enum, `outstanding_amount` recomputation, settlement) arrives in P4/P5. Two tables, symmetric.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | NOT NULL | |
| `contact_id` | UUID | NOT NULL | FK → `contact.id` ON DELETE RESTRICT. |
| `currency_id` | UUID | NOT NULL | FK → `currency.id` ON DELETE RESTRICT. |
| `original_amount` | NUMERIC(24,4) | NOT NULL | Immutable after insert (checked in a trigger — see §7). > 0. |
| `outstanding_amount` | NUMERIC(24,4) | NOT NULL | Starts at `original_amount`. Recomputed from allocations by `PaymentService` in P5 (no direct writes elsewhere). ≥ 0. |
| `origin` | `debt_origin` enum (`TRADE`, `OPENING`) | NOT NULL | D-010. Distinguishes debts inherited from the old system from debts created by an in-system trade. |
| `source_type` | TEXT | NULL | NULL when `origin='OPENING'`. `'purchase'` / `'sale'` when `origin='TRADE'`. |
| `source_id` | UUID | NULL | Same nullability rule. |
| `status` | `debt_status` enum (`OPEN`, `CLOSED`, `REVERSED`) | NOT NULL DEFAULT `OPEN` | D-013 — separate lifecycle status from payment status. `CLOSED` when `outstanding = 0`. `REVERSED` when the source trade is reversed. |
| `payment_status` | `debt_payment_status` enum (`UNPAID`, `PARTIALLY_PAID`, `PAID`) | NOT NULL DEFAULT `UNPAID` | D-013. Recomputed from allocations. `PAID` implies `status=CLOSED` (invariant). |
| `created_at`, `updated_at` | TIMESTAMPTZ(6) | NOT NULL | |

**Indexes.**

- Primary `id`.
- `(contact_id, currency_id, status)` — the contact-profile debt panel filter (spec §24 filter set).
- `(origin, source_type, source_id)` — reverse lookup during trade reversal.
- Partial index `(currency_id) WHERE status = 'OPEN'` — dashboard totals.

The polymorphic `(source_type, source_id)` pair follows the same pattern as `currency_ledger`. Same trade-off: no FK, referential integrity via tests (INV-3).

---

## 4. P4 · trades

Migration file: `20260902_add_trades`.

### 4.1 `purchase` and `sale`

Two tables, near-mirror. Every trade produces at most three ledger movements (one credit for delivered, one debit for the paid portion of payment, plus MRU on the base leg). Exactly one leg is base — enforced by trigger, see §7 (D-019).

Columns common to both:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | NOT NULL | |
| `contact_id` | UUID | NULL | NULL for walk-in trades. |
| `delivered_currency_id` | UUID | NOT NULL | FK → `currency.id`. |
| `delivered_amount` | NUMERIC(24,4) | NOT NULL | > 0. |
| `payment_currency_id` | UUID | NOT NULL | FK → `currency.id`. Distinct from `delivered_currency_id` (§7). |
| `payment_total` | NUMERIC(24,4) | NOT NULL | Total amount owed to the counterparty. > 0. |
| `rate` | NUMERIC(24,8) | NOT NULL | > 0. |
| `immediate_payment` | NUMERIC(24,4) DEFAULT 0 | NOT NULL | ≥ 0. |
| `outstanding_amount` | NUMERIC(24,4) | NOT NULL | Computed: `payment_total − immediate_payment`. Immutable after insert (like `receivable.original_amount`). ≥ 0. |
| `status` | `trade_status` enum (`CONFIRMED`, `CANCELLED`, `REVERSED`) | NOT NULL DEFAULT `CONFIRMED` | D-013 + D-021. |
| `payment_status` | `trade_payment_status` enum (`UNPAID`, `PARTIALLY_PAID`, `PAID`) | NOT NULL | Computed on insert from `immediate_payment` vs `payment_total`; recomputed after settlement in P5. |
| `payment_method_id` | UUID | NULL | FK → `payment_method.id`. Required when `immediate_payment > 0`. |
| `payment_method_note` | TEXT | NULL | Required when the linked method's `requires_note = true`. |
| `reference` | TEXT | NULL | Free-form operator reference (receipt number, etc.). |
| `notes` | TEXT | NULL | |
| `transaction_date` | TIMESTAMPTZ(6) | NOT NULL | |
| `idempotency_key` | TEXT | NULL | See P4-06. Non-NULL for API POSTs. |
| `created_by_user_id` | UUID | NOT NULL | FK → `user.id`. |
| `created_at`, `updated_at` | TIMESTAMPTZ(6) | NOT NULL | |

`sale` adds three columns:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `cost_of_currency_sold_mru` | NUMERIC(24,4) | NOT NULL | Snapshot of `currency_cost.cached_avg_mru × delivered_amount` at the moment of the sale. Persisted (not derived) because a later WAC recalc must not rewrite historical profit. |
| `gross_profit_mru` | NUMERIC(24,4) | NOT NULL | `payment_total (in MRU) − cost_of_currency_sold_mru`. Persisted for the same reason. |
| `recipient_name` | TEXT | NULL | Non-contact sales (walk-in). |
| `destination` | TEXT | NULL | Free-form ("to Dubai", "family transfer", …). |

**Indexes** (spec §24 filter set):

- `(transaction_date DESC, status)` on both tables — history + open-trades views.
- `(contact_id, transaction_date DESC)` — contact profile trades tab (P5-11).
- Unique `(created_by_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL` — P4-06 duplicate submit guard.

`receivable` / `payable` from §3.2 gain populated rows during P4 (`origin='TRADE'`). No new columns added — the skeleton was designed for this.

---

## 5. P5 · settlements + expenses

Migration file: `20260916_add_debts_expenses`.

### 5.1 `payment`

Records one payment event (money in or money out). Every payment has ≥ 1 allocation.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | NOT NULL | |
| `contact_id` | UUID | NOT NULL | FK → `contact.id` ON DELETE RESTRICT. |
| `currency_id` | UUID | NOT NULL | FK → `currency.id`. |
| `amount` | NUMERIC(24,4) | NOT NULL | > 0. Must equal `SUM(allocation.amount) WHERE payment_id = this.id` (checked in a trigger, §7). |
| `direction` | `payment_direction` enum (`RECEIVED_FROM_CUSTOMER`, `PAID_TO_SUPPLIER`) | NOT NULL | |
| `payment_method_id` | UUID | NOT NULL | FK → `payment_method.id`. |
| `payment_method_note` | TEXT | NULL | Required when the method's `requires_note = true`. |
| `status` | `payment_status` enum (`CONFIRMED`, `REVERSED`) | NOT NULL DEFAULT `CONFIRMED` | D-013 + D-021. |
| `reference`, `notes` | TEXT | NULL | |
| `transaction_date` | TIMESTAMPTZ(6) | NOT NULL | |
| `idempotency_key` | TEXT | NULL | Same pattern as trades. |
| `created_by_user_id` | UUID | NOT NULL | |
| `created_at`, `updated_at` | TIMESTAMPTZ(6) | NOT NULL | |

**Indexes.** `(contact_id, transaction_date DESC)`, `(transaction_date DESC, status)`, unique `(created_by_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

### 5.2 `allocation`

The join table between a `payment` and one or more `receivable` / `payable` rows.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | NOT NULL | |
| `payment_id` | UUID | NOT NULL | FK → `payment.id` ON DELETE RESTRICT. |
| `target_type` | TEXT | NOT NULL | Enum-in-CHECK: `'receivable'` or `'payable'` (§7). Polymorphic; no FK on `target_id`. |
| `target_id` | UUID | NOT NULL | The debt row this slice pays. |
| `amount` | NUMERIC(24,4) | NOT NULL | > 0. Must not push the target's `outstanding_amount` below zero (§7 + `PaymentExceedsDebtError`). |
| `created_at` | TIMESTAMPTZ(6) DEFAULT now() | NOT NULL | |

**Indexes.** `(target_type, target_id)` — outstanding recomputation. `(payment_id)` — reversal lookup. Both non-unique.

### 5.3 `expense`

Money out to something that is neither a supplier debt nor a trade.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID PK | NOT NULL | |
| `expense_category_id` | UUID | NOT NULL | FK → `expense_category.id` ON DELETE RESTRICT. |
| `currency_id` | UUID | NOT NULL | FK → `currency.id`. |
| `amount` | NUMERIC(24,4) | NOT NULL | > 0. |
| `payment_method_id` | UUID | NOT NULL | FK → `payment_method.id`. |
| `payment_method_note` | TEXT | NULL | Required when the method's `requires_note = true`. |
| `description` | TEXT | NOT NULL | Non-empty (spec §14.3). |
| `status` | `expense_status` enum (`CONFIRMED`, `REVERSED`) | NOT NULL DEFAULT `CONFIRMED` | D-013 + D-021. |
| `transaction_date` | TIMESTAMPTZ(6) | NOT NULL | |
| `idempotency_key` | TEXT | NULL | |
| `created_by_user_id` | UUID | NOT NULL | |
| `created_at`, `updated_at` | TIMESTAMPTZ(6) | NOT NULL | |

**Indexes.** `(transaction_date DESC, expense_category_id)`, `(currency_id, transaction_date DESC)`, unique `(created_by_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

---

## 6. P8 · rate snapshots

Migration file: `20261028_add_rate_snapshots`.

### 6.1 `rate_snapshot`

Cache of the last-known market rate per non-base currency, updated by
the external rate-service integration (P8-01). Non-authoritative — no
trade math ever reads this table; it powers the dashboard suggestion
label only.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | BIGSERIAL PK | NOT NULL | |
| `currency_id` | UUID | NOT NULL | FK → `currency.id` ON DELETE RESTRICT. |
| `mid_rate_mru` | NUMERIC(24,8) | NOT NULL | > 0. Snapshot of the mid-market rate against MRU. |
| `source` | TEXT | NOT NULL | Provider name (`'exchangerate.host'`, `'manual'`, …). |
| `fetched_at` | TIMESTAMPTZ(6) | NOT NULL | Wall clock at fetch. |
| `is_current` | BOOL DEFAULT true | NOT NULL | Only one row per currency has `is_current = true` at any moment (partial unique index, §7). |

**Indexes.** Primary `id`; partial unique `(currency_id) WHERE is_current = true`; `(currency_id, fetched_at DESC)` for the history view.

**Retention.** Rows are never deleted; historical snapshots survive for post-hoc analysis. If retention becomes a size issue, a follow-up task in P8 can add a cutoff.

---

## 7. Raw-SQL constraints — the full checklist

Every constraint below must be pasted **verbatim** into its migration
file. Prisma does not know about any of them. A CHECK on paper is not a
CHECK in the database.

The `REVOKE DELETE` calls are guarded with a `DO $$ … IF EXISTS
(SELECT 1 FROM pg_roles …) $$` block the same way the P1/P2 migrations
did — the shadow DB used by `prisma migrate dev` does not have the
`currency_app` role.

### 7.1 `currency_ledger`

```sql
-- Direction carries sign; the amount is always positive magnitude.
ALTER TABLE "currency_ledger"
  ADD CONSTRAINT "currency_ledger_amount_positive_check"
  CHECK ("amount" > 0);

-- Openings are the only source_type allowed to have a NULL source_id.
-- Every other source_type must link to its row.
ALTER TABLE "currency_ledger"
  ADD CONSTRAINT "currency_ledger_source_link_check"
  CHECK ("source_id" IS NOT NULL OR "source_type" = 'opening_balance');

-- payment_method_id is required for payment + expense movements and for
-- any movement that references a trade's cash leg with a positive
-- amount. The service enforces this contextually; the DB enforces the
-- baseline: payments and expenses always carry a method.
ALTER TABLE "currency_ledger"
  ADD CONSTRAINT "currency_ledger_method_required_for_cash_check"
  CHECK (
    "source_type" NOT IN ('payment', 'expense') OR "payment_method_id" IS NOT NULL
  );

-- Reversal soft-deletes via is_active=false. Actual DELETE is refused
-- for the application role. Shadow-DB safe (guarded).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "currency_ledger" FROM currency_app;
  END IF;
END $$;
```

### 7.2 `currency_balance`

```sql
-- Non-base currencies can never hold a negative balance. Base (MRU)
-- may be overridden by the owner (D-015) — refusing this at the DB
-- level would remove that recovery path. Enforced by a trigger because
-- a partial CHECK can't reference another table (currency.is_base).
CREATE OR REPLACE FUNCTION check_non_base_balance_nonneg()
RETURNS TRIGGER AS $$
DECLARE base_id UUID;
BEGIN
  SELECT base_currency_id INTO base_id FROM settings WHERE id = 1;
  IF NEW.currency_id <> base_id AND NEW.cached_amount < 0 THEN
    RAISE EXCEPTION 'non-base currency balance cannot go negative'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER currency_balance_nonneg_trigger
  BEFORE INSERT OR UPDATE ON "currency_balance"
  FOR EACH ROW EXECUTE FUNCTION check_non_base_balance_nonneg();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "currency_balance" FROM currency_app;
  END IF;
END $$;
```

### 7.3 `cost_movement`

```sql
ALTER TABLE "cost_movement"
  ADD CONSTRAINT "cost_movement_quantity_positive_check"
  CHECK ("quantity" > 0);

ALTER TABLE "cost_movement"
  ADD CONSTRAINT "cost_movement_unit_cost_positive_check"
  CHECK ("unit_cost_mru" > 0);

-- Realized P&L is null on acquisitions and required on disposals.
ALTER TABLE "cost_movement"
  ADD CONSTRAINT "cost_movement_pnl_shape_check"
  CHECK (
    ("kind" = 'ACQUISITION' AND "realized_pnl_mru" IS NULL) OR
    ("kind" = 'DISPOSAL' AND "realized_pnl_mru" IS NOT NULL)
  );

-- One cost row per ledger row.
CREATE UNIQUE INDEX "cost_movement_ledger_entry_unique"
  ON "cost_movement"("ledger_entry_id");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "cost_movement" FROM currency_app;
  END IF;
END $$;
```

### 7.4 `currency_cost`

```sql
-- Cached quantity must be non-negative for the same reason as balance,
-- with the same base-currency exception. Same trigger pattern as 7.2.
CREATE OR REPLACE FUNCTION check_currency_cost_nonneg()
RETURNS TRIGGER AS $$
DECLARE base_id UUID;
BEGIN
  SELECT base_currency_id INTO base_id FROM settings WHERE id = 1;
  IF NEW.currency_id <> base_id AND NEW.cached_quantity < 0 THEN
    RAISE EXCEPTION 'non-base cached_quantity cannot go negative'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER currency_cost_nonneg_trigger
  BEFORE INSERT OR UPDATE ON "currency_cost"
  FOR EACH ROW EXECUTE FUNCTION check_currency_cost_nonneg();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "currency_cost" FROM currency_app;
  END IF;
END $$;
```

### 7.5 `opening_balance`

```sql
ALTER TABLE "opening_balance"
  ADD CONSTRAINT "opening_balance_quantity_positive_check"
  CHECK ("quantity" > 0);

ALTER TABLE "opening_balance"
  ADD CONSTRAINT "opening_balance_avg_cost_positive_check"
  CHECK ("opening_avg_cost_mru" > 0);

-- Unique per currency — at most one opening per currency.
CREATE UNIQUE INDEX "opening_balance_currency_unique"
  ON "opening_balance"("currency_id");

-- No app-role DELETE; openings are immutable after go-live is enforced
-- by the OpeningBalanceService, but the app role should not be able to
-- delete even pre-go-live.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "opening_balance" FROM currency_app;
  END IF;
END $$;
```

### 7.6 `receivable` / `payable`

```sql
-- Symmetric; write both.
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_original_positive_check"
  CHECK ("original_amount" > 0);
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_outstanding_nonneg_check"
  CHECK ("outstanding_amount" >= 0);
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_outstanding_le_original_check"
  CHECK ("outstanding_amount" <= "original_amount");

-- origin=OPENING implies source is NULL; origin=TRADE implies both set.
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_origin_source_shape_check"
  CHECK (
    ("origin" = 'OPENING' AND "source_type" IS NULL AND "source_id" IS NULL) OR
    ("origin" = 'TRADE' AND "source_type" IS NOT NULL AND "source_id" IS NOT NULL)
  );

-- payment_status = 'PAID' iff outstanding = 0; status transitions
-- enforced in the service, but the invariant is encoded here.
ALTER TABLE "receivable"
  ADD CONSTRAINT "receivable_paid_iff_zero_check"
  CHECK (
    ("payment_status" = 'PAID' AND "outstanding_amount" = 0) OR
    ("payment_status" <> 'PAID' AND "outstanding_amount" > 0) OR
    ("status" = 'REVERSED')
  );

-- Immutability of original_amount enforced by trigger — CHECK cannot
-- reference OLD/NEW without one.
CREATE OR REPLACE FUNCTION receivable_original_amount_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.original_amount <> OLD.original_amount THEN
    RAISE EXCEPTION 'receivable.original_amount is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receivable_original_amount_immutable_trigger
  BEFORE UPDATE ON "receivable"
  FOR EACH ROW EXECUTE FUNCTION receivable_original_amount_immutable();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "receivable" FROM currency_app;
  END IF;
END $$;

-- Repeat all of the above for payable, s/receivable/payable/g.
```

### 7.7 `purchase` / `sale`

```sql
-- Both trade tables. Delivered and payment must be different currencies.
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_two_currencies_check"
  CHECK ("delivered_currency_id" <> "payment_currency_id");

ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_amounts_positive_check"
  CHECK (
    "delivered_amount" > 0 AND
    "payment_total" > 0 AND
    "rate" > 0 AND
    "immediate_payment" >= 0
  );

-- Outstanding derives from payment_total - immediate_payment.
-- Enforced exactly (no rounding tolerance — both are in the same
-- currency's minor unit already).
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_outstanding_matches_check"
  CHECK ("outstanding_amount" = "payment_total" - "immediate_payment");

-- Rate/total consistency within one minor unit of the payment currency.
-- The precise per-currency tolerance depends on decimal_places, so this
-- lives in a per-row trigger that reads the currency's decimal_places
-- rather than a static CHECK. Enforced in the service too (D-009);
-- trigger is the DB guard.
--
-- Exactly one leg is the base currency. Encoded as a BEFORE INSERT
-- trigger that reads settings.base_currency_id.
CREATE OR REPLACE FUNCTION check_trade_has_base_leg()
RETURNS TRIGGER AS $$
DECLARE base_id UUID;
BEGIN
  SELECT base_currency_id INTO base_id FROM settings WHERE id = 1;
  IF (NEW.delivered_currency_id = base_id) = (NEW.payment_currency_id = base_id) THEN
    RAISE EXCEPTION 'exactly one leg must be the base currency (D-019)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_base_leg_trigger
  BEFORE INSERT OR UPDATE ON "purchase"
  FOR EACH ROW EXECUTE FUNCTION check_trade_has_base_leg();

-- Same trigger applied to sale.
CREATE TRIGGER sale_base_leg_trigger
  BEFORE INSERT OR UPDATE ON "sale"
  FOR EACH ROW EXECUTE FUNCTION check_trade_has_base_leg();

-- Method required when there's actual cash movement.
ALTER TABLE "purchase"
  ADD CONSTRAINT "purchase_method_required_when_paid_check"
  CHECK ("immediate_payment" = 0 OR "payment_method_id" IS NOT NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "purchase" FROM currency_app;
    REVOKE DELETE ON TABLE "sale" FROM currency_app;
  END IF;
END $$;

-- Repeat all for sale.
```

### 7.8 `payment` / `allocation`

```sql
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "allocation"
  ADD CONSTRAINT "allocation_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "allocation"
  ADD CONSTRAINT "allocation_target_type_check"
  CHECK ("target_type" IN ('receivable', 'payable'));

-- payment.amount = SUM(allocation.amount) — enforced in a trigger on
-- allocation insert/update/delete AND on payment update, because a
-- CHECK cannot cross rows.
CREATE OR REPLACE FUNCTION check_payment_allocation_sum()
RETURNS TRIGGER AS $$
DECLARE p_amount NUMERIC; a_sum NUMERIC; pid UUID;
BEGIN
  pid := COALESCE(NEW.payment_id, OLD.payment_id);
  SELECT amount INTO p_amount FROM payment WHERE id = pid;
  SELECT COALESCE(SUM(amount), 0) INTO a_sum FROM allocation WHERE payment_id = pid;
  IF a_sum <> p_amount THEN
    RAISE EXCEPTION 'allocation total (%) does not match payment amount (%) for payment %', a_sum, p_amount, pid;
  END IF;
  RETURN NULL; -- AFTER trigger.
END;
$$ LANGUAGE plpgsql;

-- Deferred-constraint approach so a batch of INSERTs inside one txn
-- validates only at commit.
CREATE CONSTRAINT TRIGGER allocation_sum_matches_payment_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "allocation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payment_allocation_sum();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "payment" FROM currency_app;
    REVOKE DELETE ON TABLE "allocation" FROM currency_app;
  END IF;
END $$;
```

### 7.9 `expense`

```sql
ALTER TABLE "expense"
  ADD CONSTRAINT "expense_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "expense"
  ADD CONSTRAINT "expense_description_nonempty_check"
  CHECK (length(btrim("description")) > 0);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "expense" FROM currency_app;
  END IF;
END $$;
```

### 7.10 `rate_snapshot`

```sql
ALTER TABLE "rate_snapshot"
  ADD CONSTRAINT "rate_snapshot_positive_check"
  CHECK ("mid_rate_mru" > 0);

-- Only one row per currency has is_current=true at any moment.
CREATE UNIQUE INDEX "rate_snapshot_current_unique"
  ON "rate_snapshot"("currency_id") WHERE "is_current" = true;

-- No DELETE on the app role — historical snapshots are kept.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'currency_app') THEN
    REVOKE DELETE ON TABLE "rate_snapshot" FROM currency_app;
  END IF;
END $$;
```

---

## 8. Deviations from the spec

Every deviation below is tied to a decisions-log entry. If a change is
proposed during this review that lacks a D-0xx, it must be added to
`docs/decisions.md` **before** sign-off — this is the point of the paper
review.

| Area | What we do | Why | Reference |
|---|---|---|---|
| Money type | `NUMERIC(24,4)` amounts / `NUMERIC(24,8)` rates; JavaScript `number` banned on money. | Spec §7.3 requires exact arithmetic. IEEE-754 fails silently. | [D-002](decisions.md#d-002--2026-07-28--accepted) |
| Balance source of truth | Ledger append-only; `currency_balance.cached_amount` is a cache, not the truth. | Editable balances drift and can't be audited. | [D-003](decisions.md#d-003--2026-07-28--accepted) |
| Single write path | Every currency movement goes through `LedgerService.apply(tx, movements[])`. | Coupling ledger writes to one code path lets a single test cover the invariant. | [D-004](decisions.md#d-004--2026-07-28--accepted) |
| Reversal model | Movements soft-deleted via `is_active=false`; new offsetting rows appended (D-021 supersedes D-016). Cost recomputed via `CostEngine.replay`. | A history of "we made a mistake and corrected it" is more legible than a mutable row. Recompute-and-restate keeps derived tables in sync. | [D-016](decisions.md#d-016--2026-07-28--superseded-by-d-021), [D-021](decisions.md#d-021--2026-08-01--accepted) |
| Rounding | Payment_total derived at full precision; rounded to payment-currency `decimal_places` on write. Rate/total may disagree by < 1 minor unit. | Prevents "cents lost" from double-rounding. | [D-009](decisions.md#d-009--2026-07-28--accepted) |
| Status split | Every trade / payment / expense has two enums: lifecycle `status` and (for trades/receivables) `payment_status`. | Conflating lifecycle with payment progress makes reversal-of-partially-paid impossible to reason about. | [D-013](decisions.md#d-013--2026-07-28--accepted) |
| Negative balance | Non-base currencies never go negative (DB trigger); base MRU can be overridden by an owner (`balance:override`) with a reason on the audit row. | Real-world: MRU cashbox can be legitimately over-drawn in edge cases; USD cashbox never can. | [D-015](decisions.md#d-015--2026-07-28--accepted) |
| Base leg | Every trade has exactly one MRU leg — enforced by trigger reading `settings.base_currency_id`. | Cross-currency trades add a whole new failure mode not needed for the current business. | [D-019](decisions.md#d-019--2026-07-29--accepted) |
| Payment method on ledger | `payment_method_id` FK on `currency_ledger`, `payment` and `expense` rows; NULL on trade delivered legs; `requires_note` enforces a note when true. | Reporting needs "how much moved through Bankily last month" without joining across four tables. | [D-020](decisions.md#d-020--2026-07-29--accepted) |
| Debt origin | `receivable` / `payable` have `origin` enum (`TRADE` \| `OPENING`) and nullable `(source_type, source_id)`. | Opening debts have no source row; trade debts do. Same table, one enum. | [D-010](decisions.md#d-010--2026-07-28--accepted) |
| Profit visibility | `sale.gross_profit_mru` is not returned by the sale serializer unless the caller has `profit:view`. | Employees see trade totals but not the bureau's margin. | [D-018](decisions.md#d-018--2026-07-28--accepted) |
| Timestamp for period math | `period.ts` reads `settings.business_timezone`; env `BUSINESS_TZ` remains as a test-only fallback. | The tz belongs to the tenant, not the deploy. | [D-011](decisions.md#d-011--2026-07-28--accepted), [D-012](decisions.md#d-012--2026-07-28--accepted) |
| Sequence for replay | `currency_ledger.sequence` and `cost_movement.sequence` are dedicated BIGINT columns filled from a **global** Postgres SEQUENCE, not the PK. | If we ever partition or reorg PKs, replay order does not depend on it. Global chosen over per-currency in [D-023](decisions.md#d-023--2026-08-04--accepted) item 1. | [D-023](decisions.md#d-023--2026-08-04--accepted) |
| Polymorphic source columns | `(source_type, source_id)` on `currency_ledger`, `receivable`, `payable`. `allocation`'s target shape is Pending — see [D-023](decisions.md#d-023--2026-08-04--accepted) item 3, must land as its own D-0xx before P5-01. | Referential integrity via application-level tests (INV-3 / INV-4) rather than a fan of FK tables. | [D-023](decisions.md#d-023--2026-08-04--accepted) |
| Rate/total drift | Server refuses any drift between `payment_total` and `round(delivered_amount × rate, dp)`. Plain equality CHECK in the P4 migration, no per-currency tolerance trigger. | Single API client is our own frontend; controlled rounding on both sides makes tolerance pure downside. | [D-023](decisions.md#d-023--2026-08-04--accepted) item 4 |
| Idempotency key TTL | No TTL — unique per user forever. | Operators do not reuse keys; a TTL introduces "accepted after N days" surprises. | [D-023](decisions.md#d-023--2026-08-04--accepted) item 5 |
| `rate_snapshot` retention | No cutoff. Revisit only if non-base currency count grows past ~10. | ~26k rows/year for three currencies is a non-issue for years. | [D-023](decisions.md#d-023--2026-08-04--accepted) item 6 |
| Currency deactivation | Permitted at `cached_amount = 0`; refused when `> 0`. UX hint on the form guides "reduce to zero and hide". | Allows the natural liquidation flow without opening the door to hiding non-empty balances. | [D-023](decisions.md#d-023--2026-08-04--accepted) item 7 |
| Business-timezone change post-go-live | Allowed; reports carry a "period boundaries recalculated on YYYY-MM-DD" note. | Freezing tz at go-live is user-hostile; silent re-bucketing invites confusion. | [D-023](decisions.md#d-023--2026-08-04--accepted) item 2 |

---

## 9. Open questions — resolved

All seven items closed in [D-023](decisions.md#d-023--2026-08-04--accepted)
on 2026-08-04 as a single omnibus entry. One item (allocation FK) is
recorded as **Pending, owner: Lavdal** with a hard deadline of P5-01 —
it does not block P3 because `allocation` ships in P5.

| # | Item | Resolution | Reference |
|---|---|---|---|
| 1 | `currency_ledger.sequence` sourcing | Global Postgres SEQUENCE. | D-023 item 1 |
| 2 | `business_timezone` change post-go-live | Allow; reports annotate the recalculation date. | D-023 item 2 |
| 3 | `allocation` FK shape | **Pending — owner: Lavdal, ≤ P5-01.** Polymorphic vs two nullable FKs; not on the P3 critical path. | D-023 item 3 |
| 4 | Rate/total tolerance | Refuse drift; plain equality CHECK. | D-023 item 4 |
| 5 | `idempotency_key` TTL | None in v2. | D-023 item 5 |
| 6 | `rate_snapshot` retention | No cutoff. | D-023 item 6 |
| 7 | Currency deactivation with balance | Permit iff `cached_amount = 0`. | D-023 item 7 |

---

## 10. Sign-off

This PR (`P2-13`) merged 2026-08-04 with the boxes below ticked.

- [x] **Reviewed by (engineering):** Lavdal (2026-08-04)
- [x] **Reviewed by (second engineer):** Lavdal — solo project, no second
      engineer exists; the review template is honoured by the author
      walking the doc twice, a day apart, before ticking.
- [x] **Walked with client (owner):** Lavdal (2026-08-04) — this is an
      internal build; the "client" role is the author. Recorded here so
      the template box is not left ambiguously blank.
- [x] **Raw-SQL constraint list (§7) matches the P3-01 planned migration
      checklist in [`docs/phases/phase-3.md`](phases/phase-3.md#2-migrations).**
- [x] **Every open question in §9 is resolved** — [D-023](decisions.md#d-023--2026-08-04--accepted)
      bundles all seven; item 3 (`allocation` FK) is Pending, owner
      Lavdal, deadline ≤ P5-01.
- [x] **`docs/phases/phase-3.md` preamble updated** — the "written blind"
      warning is replaced with a note pointing at this signed-off review.

P3-01 is unblocked.
