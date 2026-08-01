> ⚠️ **Draft written blind.** Generated before Phase 3 closed out. The
> `LedgerService` shape landed in Phase 3 is the ground truth for this
> phase; nothing here overrides it. Refine in the week before Phase 4
> starts.

# Phase 4 — Trades (Detail)

Scope: tasks P4-01 → P4-14.
Milestone: **v2**.

Goal: purchases and sales, fully and partially paid, correct in balances,
cost basis, and profit. The spec §44 acceptance scenario runs green in CI,
verified by reading Postgres, not the UI.

Every trade has exactly one base-currency leg (D-019). The trade services
are where that rule is enforced — the ledger stays a general-purpose
primitive.

---

## 0. Hard gate

Phase 3's DoD must pass in full:

- Chokepoint grep for `currency_ledger` / `currency_balance` /
  `cost_movement` / `currency_cost` is clean and pasted into P3-A.
- Concurrent-spend test passed and log is in the PR.
- Standing invariants INV-1, INV-4, INV-6, INV-8, INV-9 are wired and
  green on every test.
- Manual `UPDATE` to negative balance was refused by the database.
- Openings match ledger sum by direct query.
- `check-invariants.ts` runs standalone.

Any P3 shortfall becomes a hard blocker: for example, if INV-9 was not
wired in P3, do not start P4-02 — trade services will write payment-method
movements immediately and INV-9 is what catches missing methods.

---

## 1. PR structure — **mandatory split**

- **PR-A — core.** P4-01 → P4-08. Migration + `PurchaseService` +
  `SaleService` + `NoBaseCurrencyLegError` + idempotency + INV-7 wired +
  §44 acceptance fixture. **No UI.**
- **PR-B — interface.** P4-09 → P4-14. Forms, lists, detail screens,
  profit-view stripping, contact profile tabs.

Same reasoning as P3: reviewing a trade service that walks the ledger
inside a single `$transaction` requires the reviewer's full attention.
Forms and lists compete for that attention.

---

## 2. Migrations

### `20260902_add_trades`

| Table | Columns of note |
|---|---|
| `purchase` | id UUID, `contact_id` FK NULL (walk-in), `delivered_currency_id` FK, `delivered_amount` NUMERIC(24,4), `payment_currency_id` FK, `payment_total` NUMERIC(24,4), `rate` NUMERIC(24,8), `immediate_payment` NUMERIC(24,4), `outstanding_amount` NUMERIC(24,4), `status` `trade_status` enum (`CONFIRMED`|`CANCELLED`|`REVERSED`), `payment_status` `trade_payment_status` enum (`UNPAID`|`PARTIALLY_PAID`|`PAID`), `payment_method_id` FK NULL (on the immediate-payment leg), `payment_method_note` TEXT NULL, `reference` TEXT NULL, `notes` TEXT NULL, `transaction_date` TIMESTAMPTZ, `created_by_user_id`, `created_at`, `updated_at` |
| `sale` | (mirror of `purchase`) plus `cost_of_currency_sold_mru` NUMERIC(24,4), `gross_profit_mru` NUMERIC(24,4), `recipient_name` TEXT NULL, `destination` TEXT NULL |

`receivable` and `payable` from P3 gain their lifecycle now — `status`,
`payment_status` — and `source_type`/`source_id` start pointing at
`purchase` / `sale` rows.

Hand-added SQL (**listed in `docs/schema-review.md`**):

- `CHECK ((delivered_currency_id = base_currency_id) <> (payment_currency_id = base_currency_id))`
  — exactly one leg is base. Enforced with a trigger that reads
  `settings.base_currency_id`.
- `CHECK (rate > 0)` on both trade tables.
- `CHECK (immediate_payment >= 0 AND outstanding_amount >= 0)`.
- `CHECK (immediate_payment + outstanding_amount = payment_total)`
  within rounding tolerance (D-009).
- Unique index on `(created_by_user_id, idempotency_key)` — see P4-06.
- Indexes for spec §24 filters:
  `purchase(transaction_date DESC, status)`,
  `purchase(contact_id, transaction_date DESC)`,
  same for `sale`.

---

## 3. Core services

### `PurchaseService.create`

One transaction covering:

1. Insert the purchase row (`status = CONFIRMED`, `payment_status`
   computed from `immediate_payment` vs `payment_total`).
2. Compute base-leg direction:
   - If MRU is on the payment leg → we spend MRU (debit) and receive
     the other currency (credit).
   - If MRU is on the delivered leg → we receive MRU (credit) and
     spend the other currency (debit).
   - **Both or neither being MRU throws `NoBaseCurrencyLegError`
     before any write.** Validated at the top of the method.
3. Build `Movement[]`: one credit for the delivered currency (full
   amount), one debit for the payment currency (only
   `immediate_payment`, which may be zero for an unpaid purchase).
   The debit carries `payment_method_id` if the immediate payment is
   non-zero; the delivered credit carries a null method
   (`architecture.md` §3.6 last paragraph).
4. Call `LedgerService.apply(tx, movements)` — **once, batch**. Not in a
   loop.
5. If `outstanding_amount > 0`, insert a `payable` row with
   `origin = TRADE`, `source_type = 'purchase'`, `source_id =
   purchase.id`.
6. Audit `purchase.created` with `before = null`, `after = purchase
   row`, actor, and reason omitted.

Validation (spec §11.5 + D-014 + D-019 + D-020):

- Delivered amount > 0, rate > 0, `immediate_payment ≤ payment_total`.
- Both currencies must be active (`InactiveCurrencyError`).
- **Balance sufficiency checked against `immediate_payment`, not
  `payment_total`** (D-014). An unpaid purchase moves no cash.
- Method required when `immediate_payment > 0`. Note required if the
  method has `requires_note` (`PaymentMethodNoteRequiredError`).
- Rate/total consistency: the server accepts either `rate` or
  `payment_total` and derives the other at full precision, rounding the
  total to the payment currency's `decimal_places` (D-009). The two are
  allowed to disagree by less than one minor unit and the CHECK
  constraint enforces the bound.

### `SaleService.create`

Mirror of purchase, plus profit snapshot:

- After `LedgerService.apply`, `CostEngine` has updated the cost cache
  for the delivered currency. Read `cost_of_currency_sold_mru` from the
  cost movement it just created; compute `gross_profit_mru =
  sale_value_in_mru − cost_of_currency_sold_mru`.
- Write both onto the sale row inside the same transaction. Never
  updated after — see architecture §3.6.
- If `outstanding_amount > 0`, insert a `receivable` row.

The §44 acceptance scenario is written as a fixture that seeds MRU + USD
and walks the two spec purchases and one spec sale. Fixed expected
values: USD balance = 6,000, MRU balance = 174,000 - immediate flows,
average cost = 39.00, gross profit on the sale = 8,000 MRU. The fixture
lives at `api/test/fixtures/spec-section-44.ts`. **CI fails if the
fixture's expected values are edited without a paired D-0xx entry** —
enforced by a git hook or a codeowner rule.

### Idempotency (P4-06)

- Every POST to `/purchases` and `/sales` carries `Idempotency-Key`
  header.
- Server stores `(created_by_user_id, idempotency_key, response_body)`
  in a small `idempotency_key` table with a 24-hour TTL.
- A repeat call within the window with the same body returns the cached
  response. A repeat with a **different** body returns 409
  `DuplicateSubmissionError` with the original request's timestamp.
- Ship the table's migration in `20260902_add_trades` — same PR.

### Profit visibility stripping (D-018)

- `SaleController` returns a DTO. The DTO's serializer strips
  `cost_of_currency_sold_mru` and `gross_profit_mru` when the caller
  does not have `profit:view`.
- Verified by an integration test: an employee GETs a sale and the JSON
  response — read from the HTTP body, not a mocked serializer — has no
  profit fields.

### Standing invariant INV-7

`api/src/common/invariants.ts`: for every purchase and every sale, one
of `delivered_currency_id`, `payment_currency_id` equals
`settings.base_currency_id` and the other does not. Runs in `afterEach`.

---

## 4. Endpoints

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/purchases` | `purchase:create` |
| GET | `/api/v1/purchases` | `purchase:read` |
| GET | `/api/v1/purchases/:id` | `purchase:read` |
| POST | `/api/v1/sales` | `sale:create` |
| GET | `/api/v1/sales` | `sale:read` |
| GET | `/api/v1/sales/:id` | `sale:read` |
| GET | `/api/v1/contacts/:id/trades` | `contact:read` + relevant trade perms |

Server-side pagination on every list endpoint. The browser never
receives more than a page (spec §41).

---

## 5. Frontend

Routes:

```
/purchases                     PurchasesListPage
/purchases/new                 PurchaseFormPage
/purchases/:id                 PurchaseDetailPage
/sales                         SalesListPage
/sales/new                     SaleFormPage
/sales/:id                     SaleDetailPage
/contacts/:id                  ContactProfilePage
    tabs: overview, receivables (P5 stub still), payables (P5 stub still), trades (real now)
```

Key components:

- `PurchaseForm` / `SaleForm` — same primitives. Direction of the rate is
  **unmistakable**: rendered as `1 <FROM> = <rate> <TO>`, with a
  live-updating "you pay X, you receive Y" preview beneath. A
  reversed-rate sanity warning triggers when the entered rate is more
  than 3× or less than 1/3 of the last recent rate for that pair
  ("Reversed? 1 USD = 39.00 MRU expected, you entered 1 USD = 0.026 MRU.
  Continue?").
- `PaymentMethodPicker` — reused; shows only `is_active` methods; the
  note field appears when `requires_note` is set. Required when
  immediate payment > 0.
- `IdempotencyKeyProvider` — generates a UUID on form mount, sends it in
  the header, regenerates on successful response so a subsequent
  intentional submit is a new operation.
- `TradeDetailFigures` — the three-numbers-not-one component: **value,
  cash, outstanding are rendered as three separate figures with
  labels**. Any refactor that collapses them into a single "amount" is
  the exact bug this project exists to prevent.
- `OfflineBanner` from P1 **now blocks writes** — the submit button is
  disabled and rendered with an explanatory tooltip when
  `navigator.onLine` is false. Spec §34: an unsent transaction is never
  rendered as confirmed. This is the deferred piece from P1-15/P3-11.

Cache keys added: `['purchases', filters]`, `['purchase', id]`,
`['sales', filters]`, `['sale', id]`, `['contact', id, 'trades']`.
Mutations list the exact keys they invalidate: creating a purchase
invalidates `['purchases']`, `['balances']`, `['contact', id, 'trades']`,
`['contact', id, 'debts']`.

---

## 6. Tests

Priority order:

1. **P4-04 / D-019** Trade with two MRU legs → `NoBaseCurrencyLegError`.
   Trade with two non-MRU legs → same error. Over HTTP.
2. **P4-04 + P4-08** Rate/total consistency: POST with rate only, POST
   with total only, POST with both consistent, POST with both
   inconsistent beyond tolerance (rejected).
3. **P4-08** Concurrent sale of the same currency balance — one wins.
4. **P4-02** Fully paid purchase — ledger has two entries, balance
   correct on both currencies, cost cache updated, no `payable` row.
5. **P4-02** Partially paid purchase — ledger has two entries (one for
   `immediate_payment`, one for delivered), `payable` row exists with
   `outstanding = payment_total − immediate_payment`.
6. **P4-02** Unpaid purchase — one ledger entry (delivered credit only,
   no debit), full `payable`.
7. **P4-03** Three sale equivalents (fully / partially / unpaid).
8. **P4-03 §44 fixture** — the acceptance scenario runs and every figure
   matches expected. Verified **by direct query on Postgres**.
9. **P4-06** Same idempotency key, same body → cached response. Same
   key, different body → 409.
10. **P4-05** Insufficient balance rejection on the immediate-payment
    leg, not on `payment_total` (D-014). Structured data verified.
11. **P4-05 + D-020** Missing `payment_method_id` when immediate_payment
    > 0 → 422. `requires_note` method with empty note → 422.
12. **P4-05** Inactive delivered currency rejected.
13. **P4-13** Employee GETs a sale — no `gross_profit_mru`, no
    `cost_of_currency_sold_mru` fields in the HTTP body (curl'd, not
    UI-rendered).
14. **P4-07 + INV-7** After every §44 fixture step, every ledger row
    has an active source and every trade has exactly one MRU leg.
15. **P4-08 rollback** Mid-transaction failure (mocked cost engine
    throw) leaves no purchase row and no ledger row.

---

## 7. Definition of Done — checklist

- [ ] Spec §44 CI fixture is green — every figure (USD balance 6,000,
      average cost 39.00, gross profit 8,000 MRU) matches expected by
      direct query. Query output pasted into PR-A.
- [ ] `curl` POST of a trade with no MRU leg returns 422
      `NoBaseCurrencyLegError`. Output pasted into PR-A.
- [ ] Partially paid sale detail screen shows sale value, cash
      collected, and receivable outstanding as **three distinct
      numbers**. Screenshot into PR-B.
- [ ] Double-tapping submit on a real phone on a flaky connection
      creates exactly one sale (idempotency verified end-to-end).
      Reproduced with a throttled network profile in devtools; log in
      PR-B.
- [ ] `curl` GET a sale as an employee-role user → response body has no
      `gross_profit_mru` / `cost_of_currency_sold_mru`. Output pasted.
- [ ] Chokepoint grep re-run — every write to ledger tables is inside
      `LedgerService`. Grep output pasted into PR-A.
- [ ] INV-7 wired and green on every test. Deliberately broken row on a
      scratch DB produces a red run.
- [ ] Offline banner **blocks writes** — pressing submit while offline
      does nothing and the button is visibly disabled. Component test
      passes.

---

## 8. Explicitly deferred

- **Payments and allocations** — Phase 5. `receivable` / `payable` gain
  lifecycle status here but no `PaymentService` exists.
- **Reversal of trades** — Phase 6. `status = REVERSED` is a valid enum
  value but nothing sets it.
- **Multi-target payments** — Phase 5 (schema now, single-target UI in
  v1 per D-011).
- **Cross-pair trades** — D-019 rejected them; not deferred, forbidden.
- **Rate lookup from a market feed** — Phase 8. Rates are operator-typed
  here.
- **Profit report screens** — Phase 7. Profit is *stored* here (on the
  sale row) but not *reported* anywhere yet.
- **Sale receipt PDF / print** — not in scope in v2. If asked, it is a
  reports concern.
- **Currency conversion for consolidated reporting** — Phase 7. Every
  amount is still shown in its own currency in P4.
- **Bulk trade entry / CSV import** — never asked for, do not add
  uninvited.
