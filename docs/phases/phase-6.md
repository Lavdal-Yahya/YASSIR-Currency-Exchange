> ⚠️ **Draft written blind.** Generated before Phase 5 closed out. Refine in
> the week before Phase 6 starts.
>
> **D-016 status:** resolved 2026-08-01 by D-021 — **recompute and restate**
> (Shape A below). Shape B is retained in this doc as rejected-context for
> reviewers; do not build it.

# Phase 6 — Profit, reversal & audit (Detail)

Scope: tasks P6-01 → P6-08.
Milestone: **v3**.

Goal: profit is reportable and correct, and a mistake made yesterday can
be undone today without corrupting anything.

Reversal is the only undo. Every reversal is a compensating transaction
that leaves history visible, sets `is_active = false` on the affected
ledger and cost movements, cascades allocation liveness for free (D-011),
and asks `CostEngine.replay` to recompute forward rather than patch —
recomputation is idempotent, patching accumulates drift.

---

## 0. Hard gate

Phase 5's DoD must pass:

- Every debt figure on screen matches an allocation-table query.
- INV-2, INV-3, INV-5, INV-9 all green.
- Chokepoint grep clean.

**Phase-specific gate:**

- **D-016 is resolved** — D-021 chose recompute-and-restate. P6-04 designs
  Shape A only.
- The recompute path from P5 (`RecomputeService.recompute`) is proven
  idempotent. Reversal reuses it.
- `CostEngine.replay(currencyId)` from P3 works and matches incremental
  `apply()` on a fixture (P3-04 test). Trade reversal leans on this.

---

## 1. PR structure

Suggested split:

- **PR-1** (P6-01, P6-02): profit engine + base-currency consolidation.
  No reversal yet.
- **PR-2** (P6-03, P6-05): reversal of expenses and payments +
  reversal permission gating. Small blast radius; ships first.
- **PR-3** (P6-04): reversal of trades. Per D-021: `CostEngine.replay`
  invocation plus forward-restatement of every affected downstream sale's
  `cost_of_currency_sold_mru` and `gross_profit_mru`. The API response
  carries the count and IDs of restated sales so the frontend can name
  the consequence to the operator.
- **PR-4** (P6-06, P6-07, P6-08): audit viewer + user activity report +
  the reversal test suite.

---

## 2. Migrations

### `20260930_profit_and_reversal`

- Add `reversal_reason` TEXT, `reversed_by_user_id` UUID FK,
  `reversed_at` TIMESTAMPTZ on `purchase`, `sale`, `payment`, `expense`.
- Add nothing to the ledger tables — `is_active` already exists (P3).
- Ledger index `currency_ledger(is_active) WHERE is_active = true` if
  the invariant queries end up slow (profile first, add second).

No schema change is needed for profit computation itself — every input
is already present (see D-018 snapshots).

---

## 3. Core services

### `ProfitService`

Read-only. Public methods:

- `grossProfitByPeriod(from, to)` — `Σ sale.gross_profit_mru` for
  confirmed sales in the period. Excludes reversed.
- `grossProfitByCurrency(from, to)` — same, grouped by
  `sale.delivered_currency_id`.
- `costOfCurrencySold(from, to)` — `Σ sale.cost_of_currency_sold_mru`.
- `realizedFxGain(from, to)` — `Σ realized_pnl_mru` across
  `cost_movement` rows in the period whose kind is `DISPOSAL` and
  source is a `payment` (settlement FX per D-017), separate from
  disposals whose source is a `sale`.
- `expensesByPeriod(from, to, byCategory?)`.
- `netProfitByPeriod(from, to)` — `gross_profit + realized_fx_gain −
  expenses`. Explicit formula documented in the response DTO.

All queries filter by active status via `common/active-filter.ts`
(one shared source of truth), not by scattered `where` clauses.

Consolidation into base currency uses **stored snapshot rates only**
— never a live rate — per spec §20 and D-007's superseded reasoning.
For P6, every stored figure is already in MRU (via `_mru` suffixed
columns), so consolidation is trivial. `P6-02` is largely a check
that no report reaches for `market_rate` when computing profit.

### `TradeReversalService` (P6-04, per D-021)

Shape A (recompute-and-restate) is the chosen path. Shape B is retained
below as rejected-context so reviewers see why the tree was pruned.

**Shape A — Recompute and restate. [CHOSEN — D-021]**

1. Verify caller has `reversal:trade`.
2. In a single transaction:
   - Set `sale.status = REVERSED` (or `purchase.status = REVERSED`).
   - Flip `is_active = false` on the sale's ledger entries and cost
     movements.
   - Call `CostEngine.replay(tx, currencyId)` for each currency the
     trade touched. Replay reads only active cost movements, in
     `sequence` order.
   - For every downstream sale that used the disposal-time average
     that the replay just changed, recompute `cost_of_currency_sold_mru`
     and `gross_profit_mru` (this is the "restate" step). Write the
     new values onto the sale rows.
   - Recompute the associated payable/receivable via
     `RecomputeService.recompute`. Since the trade is inactive, its
     downstream allocation liveness is affected: those allocations now
     have an inactive target and are excluded from the recomputation
     (D-011).
   - Audit `sale.reversed` / `purchase.reversed` with the mandatory
     reason.
3. Return the restated sales in the response so the frontend can warn
   the operator: "This reversal restated N prior sales' profit."

**Shape B — Block and adjust. [REJECTED by D-021 — do not build]**

Kept here as rejected-context. See D-021 for reasoning: the compensating
adjustment either violates D-019 (no MRU leg) or introduces a new
"adjustment" record type outside the trade model — both larger surface
area than the replay path that already exists.

1. Verify caller has `reversal:trade`.
2. Check whether any *later* cost movement exists on the affected
   currency (`SELECT 1 FROM cost_movement WHERE currency_id = $1 AND
   sequence > $2 AND is_active`). If yes → 422
   `ReversalBlockedByLaterMovementsError`, with the count of blocking
   movements.
3. If no later movements, proceed as in Shape A but skip the restate
   step (there's nothing downstream).
4. For the "reversal is blocked" case, offer an *adjustment
   transaction* — a new trade dated today with negated amounts and a
   pointer to the original — which does not touch history.

In both shapes, INV-1/2/3/4/5/6/7/8/9 must hold after the reversal.
The suite's `afterEach` already asserts this; the test list below
adds targeted cases.

### `PaymentReversalService` and `ExpenseReversalService` (P6-03)

Simpler — no cost engine complication:

1. Flip `status = REVERSED` with reason + actor.
2. Flip `is_active = false` on the ledger entry and any cost movement.
3. Cascade allocation liveness by re-running
   `RecomputeService.recompute` on each affected receivable/payable
   (allocations of an inactive payment are automatically excluded).
4. Audit.

Reversal permission `reversal:*` is separately audited (P6-05): the
audit action is `reversal.granted` and includes the caller's role
snapshot.

### `AuditViewerService` (P6-06)

- Read `audit_log` filtered by entity, actor, date range.
- Renders `before` / `after` as a diff. Only fields present in both are
  diffed — the audit rows already carry deltas only, so the diff is
  small.
- Owner-only (`audit:read`).

### `UserActivityReport` (P6-07)

- Per user, over a period: counts of purchases, sales, payments,
  expenses, reversals, failed logins.
- Backed by grouped audit_log queries. No new table.

---

## 4. Endpoints

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/reports/profit` | `profit:view` |
| GET | `/api/v1/reports/user-activity` | `audit:read` |
| POST | `/api/v1/purchases/:id/reverse` | `reversal:trade` |
| POST | `/api/v1/sales/:id/reverse` | `reversal:trade` |
| POST | `/api/v1/payments/:id/reverse` | `reversal:payment` |
| POST | `/api/v1/expenses/:id/reverse` | `reversal:expense` |
| GET | `/api/v1/audit-log` | `audit:read` |

Every reversal endpoint requires a `reason` in the body — validated as
non-empty. The reason ends up in the audit row.

---

## 5. Frontend

Routes:

```
/reports/profit                        ProfitReportPage
/reports/user-activity                 UserActivityReportPage
/audit                                 AuditLogPage (owner-only)
/purchases/:id                         PurchaseDetailPage — adds Reverse button
/sales/:id                             SaleDetailPage — adds Reverse button
/payments/:id                          PaymentDetailPage — adds Reverse button
/expenses/:id                          ExpenseDetailPage — adds Reverse button
```

Key components:

- `ReversalDialog` — reason field (required), confirms with the
  operator, submits to the reversal endpoint. Shows the response
  count of "restated sales" if Shape A was chosen for D-016.
- `ProfitReportPage` — period + currency filters, breakdown by gross,
  FX, expenses, net. Explicit formula shown ("Net = Gross + FX gain
  on settlements − Expenses").
- `AuditLogViewer` — entity picker, actor picker, date range, table
  with before/after diff panels.
- **Reversal buttons render only for users with the relevant
  permission** — a courtesy, not enforcement. The API is authoritative.

Cache keys: `['reports', 'profit', filters]`,
`['reports', 'user-activity', filters]`, `['audit', filters]`. Reversal
mutations invalidate a wide net: `['purchases']`, `['sales']`,
`['payments']`, `['expenses']`, `['balances']`, `['receivables']`,
`['payables']`, `['contact', id, '*']`, `['reports', '*']`. This is the
one place where a broad invalidation is defensible because reversal
touches everything.

---

## 6. Tests

Priority:

1. **P6-08 + INV-1..9** After every reversal test in the suite, every
   invariant holds. Wire deliberately-broken fixtures for at least two
   invariants and confirm the suite goes red.
2. **P6-03** Reverse a fully paid sale: sale.status = REVERSED,
   ledger entries inactive, receivable (if any) removed from
   outstanding, balances by direct query match a pre-sale snapshot.
3. **P6-03** Reverse a partially paid purchase whose payable has
   received two payments: payable is inactive, its allocations no
   longer count (their target is inactive), those payments'
   outstanding-allocation totals shift accordingly. Verified by direct
   query.
4. **P6-04** Reverse a purchase whose currency was later sold — the prior
   sale's `gross_profit_mru` and `cost_of_currency_sold_mru` are recomputed
   on the sale row. Compared to a hand-computed expected. The API response
   lists the restated sale's ID.
5. **P6-04** Reverse a trade with no downstream cost movements — succeeds,
   response reports zero restated sales.
6. **P6-08 idempotency** Reversing an already-reversed row → 422
   `AlreadyReversedError`; replay is safe.
7. **P6-05** Employee without `reversal:trade` gets 403 on the reverse
   endpoint. Curl output.
8. **P6-05** Every reversal has a non-empty reason in the audit_log,
   verified by query.
9. **P6-01** Profit engine on the §44 fixture: gross profit 8,000 MRU
   for the period covering the sale, expenses zero, net = gross.
10. **P6-01 (with expense fixture)** Adding a 500 MRU expense in the
    same period drops net profit by 500.
11. **P6-01 (with settlement)** Adding a supplier settlement in EUR at
    a drifted average produces the expected FX gain in the report.
12. **P6-02** No report reads from the market rate for a historical
    period — grep and unit test guard this.
13. **P6-08 exclusion** A reversed sale contributes zero to every
    report: profit, gross, cost, and the debt-summary reports.

---

## 7. Definition of Done — checklist

- [ ] Reversing a partially settled purchase restores the payable, the
      balance, and the cost basis to values verified by direct query.
      Query outputs pasted.
- [ ] `curl` a reversal endpoint without the permission → 403.
- [ ] Every reversal in the test suite has a non-empty reason in the
      audit_log, verified by `SELECT`.
- [ ] `api/scripts/check-invariants.ts` after the full reversal test
      run reports `OK` against the test database.
- [ ] A reversed trade appears in no report: profit, cash-in, cash-out
      — verified with SQL against the seeded fixture — but still
      appears in history when queried directly.
- [ ] D-016 resolved — done (D-021, 2026-08-01). PR-3 builds Shape A only.
- [ ] Profit report on the §44 fixture matches expected (gross 8,000
      MRU). Screenshot + query output.
- [ ] Chokepoint grep is still clean after all reversal writes.

---

## 8. Explicitly deferred

- **Recomputation notification / restate log** — if Shape A is chosen,
  the operator sees a count of restated sales in the API response.
  Emailing them or persisting a "restatement log" is not in scope.
- **Reversal reversal** ("un-reverse") — not in scope. If a reversal
  was wrong, create a new compensating trade.
- **Cross-period reversal warnings** — if the reversed row's original
  period has been "closed" (no such concept exists yet), warn. Deferred
  because closing is not modelled — the audit log is the seal.
- **Multi-actor sign-off on reversal** — the spec does not require it;
  every reversal is single-actor with a reason.
- **Undo of an audit_log row** — impossible by design (append-only,
  REVOKE DELETE).
- **Dashboard cards** — Phase 7. Profit is *computed* here but not
  *shown on the dashboard* here.
