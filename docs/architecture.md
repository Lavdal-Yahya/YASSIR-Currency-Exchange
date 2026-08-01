# Architecture

This defines the structural decisions every feature must fit into. It should
change rarely. If a task seems to require violating something here, stop and
discuss — either the task is wrong or this needs a deliberate, recorded
amendment in `decisions.md`.

---

## 1. System overview

```
   Phone / tablet / desktop browser
                │  HTTPS
                ▼
   ┌────────────────────────────┐
   │  React SPA (PWA)           │   installable, cached shell,
   │  AR / FR, RTL-aware        │   NO offline writes (spec §34)
   └────────────┬───────────────┘
                │  REST /api/v1, JWT in httpOnly cookie
                ▼
   ┌────────────────────────────┐
   │  NestJS API                │   permission guards on every route
   │  ├─ modules (feature)      │
   │  ├─ LedgerService  ◄────── │   THE chokepoint (§3.3)
   │  └─ CostEngine             │
   └────────────┬───────────────┘
                │  Prisma, every write in an explicit $transaction
                ▼
   ┌────────────────────────────┐
   │  PostgreSQL                │   NUMERIC money, CHECK constraints,
   │                            │   append-only financial tables
   └────────────────────────────┘
                │
                ▼  nightly pg_dump → off-server storage
```

Single VPS, Docker Compose behind Traefik, one Postgres instance. No
microservices, no queue, no cache server. One nightly cron job refreshes market
exchange rates and is allowed to fail without affecting anything else.

---

## 2. Repository layout

```
/                      monorepo, npm workspaces
├─ api/                NestJS
│  ├─ prisma/          schema.prisma, migrations/
│  └─ src/
│     ├─ common/       guards, decorators, domain errors, decimal helpers
│     ├─ ledger/       LedgerService, CostEngine  ← the dangerous 25%
│     ├─ currencies/  contacts/  users/  settings/
│     ├─ trades/       purchases, sales
│     ├─ debts/        receivables, payables, payments, allocations
│     ├─ expenses/  reports/  rates/  audit/
├─ web/                React + Vite
│  └─ src/
│     ├─ app/          routing, providers, layout shell
│     ├─ features/     one folder per domain area
│     ├─ shared/       api client, formatters, form primitives, i18n
├─ docs/               this folder
└─ tasks.md
```

Feature modules may depend on `common/` and on `ledger/`. They may **not**
import each other's services — cross-module needs go through a published
service interface or, better, don't exist.

---

## 3. Backend architecture

### 3.1 Layering

```
Controller → Service → Prisma
```

- **Controller**: DTO validation, permission decorator, calls exactly one
  service method, maps domain errors to HTTP. No business logic, no Prisma.
- **Service**: owns the transaction boundary. Opens `prisma.$transaction`,
  performs all reads and writes on the transaction client, throws typed domain
  errors.
- **Prisma**: only ever called from services.

No repository layer. It buys nothing here and hides the transaction client,
which is the one thing that must stay visible.

### 3.2 Module map

| Module | Owns | Writes to ledger? |
|---|---|---|
| `ledger` | ledger entries, balance cache, cost movements, cost cache | **it is the ledger** |
| `trades` | purchases, sales | via `LedgerService` |
| `debts` | receivables, payables, payments, allocations | via `LedgerService` |
| `expenses` | expenses, categories | via `LedgerService` |
| `openings` | opening balances and debts | via `LedgerService` |
| `currencies`, `contacts`, `users`, `settings`, `rates`, `audit`, `reports` | master data / read models | **never** |

### 3.3 The chokepoint

> **There is exactly one code path that changes a currency balance:**
>
> ```ts
> LedgerService.apply(tx: Tx, movements: Movement[]): Promise<LedgerEntry[]>
> ```
>
> `tx` is a **required** parameter. There is no non-transactional variant, so
> "change a balance outside a transaction" is not expressible.
>
> It sorts `movements` by `currencyId` ascending, then `SELECT … FOR UPDATE`s
> the corresponding `currency_balance` rows in that order. A trade touches two
> currencies; two concurrent trades locking them in opposite orders deadlock.
> Sorting is what prevents that.
>
> It validates every resulting balance **before** writing, so errors carry
> useful data ("insufficient USD: 400.00 available, 1,000.00 requested") rather
> than surfacing as constraint violations.
>
> It writes the ledger entries, updates the balance cache, and hands each
> movement to `CostEngine` for acquisition/disposal accounting.
>
> Nothing else writes to `currency_ledger`, `currency_balance`,
> `cost_movement`, or `currency_cost`. The database independently enforces
> `cached_amount >= 0` for every non-base currency.

A `Movement` carries `{ currencyId, direction, amount, sourceType, sourceId,
transactionDate, description, costEffect, paymentMethodId? }`. The payment method
is optional at the type level and required by the *services* for movements that
represent external cash (D-020) — `LedgerService` records it, it does not police
which movements need one.

**The base-leg rule (D-019) is enforced above the ledger, in the trade services**,
not inside `apply()`: exactly one leg of a purchase or sale must be the base
currency, or the trade is rejected with `NoBaseCurrencyLegError`. `LedgerService`
stays a general-purpose primitive so that expenses, settlements, and opening
balances — none of which have two legs — can use it unchanged.

**It is a batch API.** Calling `apply()` in a loop inside one business operation
is a bug — that loop reintroduces exactly the lock-ordering problem the batch
form exists to prevent. A single movement is `apply(tx, [m])`.

Every phase that touches money has a Definition-of-Done item requiring a grep
over write sites for these four tables, including raw SQL, confirming they all
sit inside `LedgerService`. Prisma and raw queries use different table-name
casing — grep for both.

### 3.4 Transaction boundaries

One transaction per business operation, opened at the top of the service
method. Creating a partially paid sale is a single transaction containing:

1. the sale row,
2. two ledger entries (deliver currency out, payment currency in),
3. a cost disposal and a cost acquisition,
4. the receivable for the outstanding amount,
5. the gross-profit computation written onto the sale,
6. the audit log entry.

All succeed or none do. **Never mix `tx` and non-`tx` calls inside one
operation** — a single stray `this.prisma.x` silently escapes the rollback and
leaves a ledger entry with no sale.

### 3.5 Derived vs stored

| Value | Truth | Cache | Invariant |
|---|---|---|---|
| Currency balance | sum of active ledger entries | `currency_balance.cached_amount` | INV-1 |
| Weighted-average cost | replay of active cost movements | `currency_cost.cached_avg` | INV-4 |
| Receivable outstanding | original − active allocations | `receivable.outstanding_amount` | INV-2 |
| Payable outstanding | original − active allocations | `payable.outstanding_amount` | INV-3 |
| Contact debt totals | aggregation over receivables/payables | none | — |

A cache that disagrees with its truth is a bug in the code that maintains it,
and the invariant tests (§ conventions 5) are how we find out.

**Allocation liveness is derived, never stored**: an allocation counts if and
only if its payment row and its target row are both `CONFIRMED`. Reversal flips
one flag rather than synchronizing three tables.

### 3.6 Snapshots

These are written once at confirmation and **never updated**, because they must
reflect the moment the deal happened:

- `rate` — the agreed business rate. Market-rate refreshes must never touch it
  (spec §21.2).
- `total_value`, `immediate_payment`, `outstanding_amount` at creation.
- `payment_method_id` on each cash-movement ledger entry (D-020). Frozen with the
  movement: renaming or deactivating a method later must not rewrite how last
  year's money arrived.
- `cost_of_currency_sold`, `gross_profit` — computed from the cost engine at
  confirmation, per spec §19.5 (profit is recognized at sale, not at
  collection).

A report re-run next year reproduces last year's numbers exactly, for free.

### 3.7 Cancellation model

Financial records are **never deleted**. A reversal is a compensating
transaction that:

1. flips the source row to `REVERSED` with a mandatory reason and actor,
2. writes *new* ledger entries in the opposite direction (the originals stay
   visible in history),
3. marks the cost movements inactive and asks `CostEngine` to **recompute**
   forward rather than subtracting deltas — recomputation is idempotent and
   self-correcting; patching accumulates drift,
4. cascades liveness to allocations automatically (§3.5), so receivables and
   payables correct themselves,
5. writes an audit entry.

Reports exclude non-active rows by filtering `status` in **one shared place**
(`common/active-filter.ts`), not by remembering to add a where-clause.

Master-data entities with history are **archived, not deleted** (spec §7.2).
Hard delete is permitted only when a history check proves the entity is
unreferenced.

> D-016 resolved by D-021 (2026-08-01): reversing a purchase whose currency has
> since been sold **restates** prior profit — `CostEngine.replay` runs forward
> from the reversed cost movement and every affected downstream sale's
> `gross_profit_mru` / `cost_of_currency_sold_mru` is rewritten in the same
> transaction. Reports covering the affected period may change after a
> reversal; the reversal dialog names this consequence before confirmation.

### 3.8 Errors

Typed domain errors in `common/errors/`, each carrying structured data and
mapping to one HTTP status and one i18n key:

| Error | HTTP | i18n key |
|---|---|---|
| `InsufficientBalanceError` | 422 | `error.insufficient_balance` |
| `PaymentExceedsOutstandingError` | 422 | `error.payment_exceeds_debt` |
| `InactiveCurrencyError` | 422 | `error.currency_inactive` |
| `NegativeBalanceOverrideDeniedError` | 403 | `error.override_denied` |
| `DuplicateSubmissionError` | 409 | `error.already_submitted` |
| `NoBaseCurrencyLegError` | 422 | `error.no_base_leg` |
| `PaymentMethodNoteRequiredError` | 422 | `error.method_note_required` |
| `RateUnavailableError` | 503 | `error.rate_service_down` |

Raw exceptions and stack traces never reach the client (spec §42). Every error
message the user sees exists in both AR and FR.

---

## 4. Authentication & authorization

Phone number + numeric PIN, argon2-hashed, JWT in an httpOnly SameSite cookie
with a sliding expiry. Rate limiting on the login route; lockout after repeated
failures. Admin-initiated PIN reset only — no email flow, since the client's
users may not have email.

Permissions are **strings on the role**, checked by a guard decorator on every
route: `@RequirePermission('sale:create')`. The guard is the enforcement point;
the frontend hides buttons purely as a courtesy. Any route without an explicit
permission decorator fails closed — this is asserted by a unit test that
enumerates the route table.

`profit:view` is a distinct permission and is applied in the serializer, not
just the route (D-018).

---

## 5. Frontend architecture

- **Server state**: TanStack Query. Cache keys are namespaced arrays:
  `['sales', { filters }]`, `['balances']`, `['contact', id, 'debts']`. Every
  mutation names the exact keys it invalidates — no blanket `invalidateQueries()`.
- **Client state**: component state and URL search params. No global store; if
  something needs one, that's a signal the server state is being duplicated.
- **Forms**: React Hook Form + zod, with the zod schema shared with the API DTO
  where practical. Money inputs are string-typed all the way to the wire — the
  browser never parses a monetary value into a `number`.
- **The save button disables on submit and every mutating request carries an
  idempotency key** (spec §33). The server rejects a repeat key within the
  window with `DuplicateSubmissionError`.
- **i18n**: `react-i18next`, AR and FR, `dir` driven by the active language,
  logical CSS properties (`margin-inline-start`, not `margin-left`) throughout.
- **Formatters**: one shared `formatMoney(amount, currency)` that renders the
  currency code beside every value and rounds only for display (spec §36).
  Currency codes, never symbols alone — "USD 1,000", not "$1,000".
- **PWA**: installable, cached shell, cached previously-viewed pages. A visible
  offline banner, and every mutating form is **disabled** while offline. An
  unsent transaction is never rendered as confirmed (spec §34).

---

## 6. Database

- Prisma migrations, checked in, never edited after merge. Constraints Prisma
  can't express are added as raw SQL inside the generated migration file and
  **eyeballed before commit** — regenerating a migration silently drops hand
  edits.
- Money: `NUMERIC(24,4)`. Rates: `NUMERIC(24,8)`. No `float`, ever.
- CHECK constraints as the independent last line of defense:
  `currency_balance.cached_amount >= 0` for non-base currencies,
  `receivable.outstanding_amount >= 0`, `payable.outstanding_amount >= 0`,
  `allocation.amount > 0`, `payment_base_rate > 0`.
- Indexes on every column the spec's filters touch (spec §24): transaction
  date, currency, contact, status, created_by, reference.
- Financial tables have no `DELETE` grant for the application role.

---

## 7. Deployment & operations

Docker Compose on the VPS behind Traefik with automatic TLS. Config entirely
through environment variables; no secret ever reaches the frontend bundle.
Structured JSON logs. Nightly `pg_dump` to off-server storage with a retention
policy, plus a manual backup before every migration.

**A backup that has never been restored is not a backup** (spec §39). A restore
rehearsal into a scratch database is a Definition-of-Done item in Phase 8, and
it does not get deferred.

---

## 8. What this deliberately does NOT have

- No microservices, message queue, event bus, or Redis.
- No offline transaction creation, and no sync engine (spec §34).
- No automatic netting of a contact's receivables against their payables — the
  spec forbids it (§17) and the temptation will recur.
- No cross-currency debt settlement in v1 (spec §15.2).
- No customer overpayment credits (spec §15.4).
- No customer or supplier portal, no native app, no notifications.
- No general ledger, chart of accounts, or double-entry bookkeeping. This is an
  operational tool, not an accounting system (spec §1).
- No soft-delete flag on financial rows — reversal is the only undo.
- No split payments — one payment method per cash movement (D-020).
- No trade without a base-currency leg. It is rejected, not converted (D-019).
