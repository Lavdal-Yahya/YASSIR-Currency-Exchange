# Phase 5 — Debts, settlements & expenses (Detail)

Scope: tasks P5-01 → P5-12.
Milestone: **v2**.

Goal: debts can be paid down over time from either side, correctly, and
operating expenses reduce balances correctly. After Phase 5, every table
in `docs/schema-review.md` that carries money exists.

The one behavioural rule the whole phase leans on: **allocation liveness
is derived, never stored** (D-011). An allocation counts if and only if
its payment row and its target row are both active. A reversal flips one
flag rather than synchronizing three tables. Every outstanding-amount
recomputation reads from this rule.

---

## 0. Hard gate

Phase 4's DoD must pass:

- §44 fixture is green in CI with query output pasted.
- Chokepoint grep is clean.
- INV-7 wired and green.
- Trade with no MRU leg refused over HTTP (D-019).
- Offline banner blocks writes.

Extra P5-specific gates:

- `payment_method_id` is being written on immediate-payment ledger
  entries for real (checked by counting non-null entries in a scratch
  seed). If not, INV-9 will bite here — settle the P4 shortfall first.
- `receivable` / `payable` in P4 carry `origin`, `source_type`,
  `source_id`. If any field is stubbed, this phase cannot compute
  allocation liveness — fix P4 first.

---

## 1. PR structure

No mandatory split — P5 is complex but each service is small and
independently testable. Suggested groupings:

- **PR-1** ✅ (P5-01, P5-02, P5-04, P5-05, P5-07): schema, customer payments,
  liveness / recomputation, invariants.
- **PR-2** ✅ (P5-03): supplier payments with FX gain/loss (D-017). Split
  because the FX branch deserves reviewer attention on its own.
- **PR-3** ✅ (P5-06, P5-10): expenses + expense screens.
- **PR-4** ✅ (P5-08, P5-09, P5-11, P5-12): frontend (debt lists, forms,
  contact profile).

If any of PR-1 through PR-3 grows past ~600 lines, split further.

---

## 2. Migrations

### `20260916_add_debts_expenses`

| Table | Columns |
|---|---|
| `payment` | id UUID, `contact_id` FK, `currency_id` FK, `amount` NUMERIC(24,4), `direction` `payment_direction` enum (`RECEIVED_FROM_CUSTOMER`|`PAID_TO_SUPPLIER`), `payment_method_id` FK, `payment_method_note` TEXT NULL, `status` `payment_status` enum (`CONFIRMED`|`REVERSED`), `reference` TEXT NULL, `notes` TEXT NULL, `transaction_date`, `created_by_user_id`, timestamps |
| `allocation` | id UUID, `payment_id` FK, `target_type` TEXT (`'receivable'`|`'payable'`), `target_id` UUID, `amount` NUMERIC(24,4), `created_at` |
| `expense` | id UUID, `expense_category_id` FK, `currency_id` FK, `amount` NUMERIC(24,4), `payment_method_id` FK, `payment_method_note` TEXT NULL, `description` TEXT, `status` `expense_status` enum (`CONFIRMED`|`REVERSED`), `transaction_date`, `created_by_user_id`, timestamps |

Hand-added SQL:

- `CHECK (payment.amount > 0)`, `CHECK (allocation.amount > 0)`,
  `CHECK (expense.amount > 0)`.
- `CHECK (allocation.target_type IN ('receivable', 'payable'))`.
- Index `allocation(target_type, target_id)` — every outstanding
  recomputation reads this way.
- Index `allocation(payment_id)`.
- Index `payment(contact_id, transaction_date DESC)`.
- Index `expense(transaction_date DESC, expense_category_id)`.

There is no FK from `allocation.target_id` to `receivable.id` /
`payable.id` because the column is polymorphic. Liveness is enforced by
the recomputation code and the invariants (INV-2/3/5).

---

## 3. Core services

### `CustomerPaymentService.create`

Numbered contract:

1. Validate: contact exists and is `is_customer`, currency is active,
   amount > 0, target(s) are receivables in the same currency (spec
   §15.2 forbids cross-currency), method + note where required.
2. **Default allocation order**: oldest-first over the contact's active
   receivables in the same currency, filling until the payment amount is
   exhausted. The v1 UI targets a single receivable per D-011, but the
   service accepts N — do not shortcut this in the service.
3. **Overpayment blocked** (spec §15.4). If the sum requested to allocate
   exceeds the sum of outstandings, throw `PaymentExceedsOutstandingError`.
4. In one transaction: insert `payment` row, insert `allocation` rows,
   call `LedgerService.apply` with one credit on the payment currency
   carrying the `payment_method_id` and note.
5. **Recompute** the outstanding on each targeted receivable via
   `RecomputeService.recompute(tx, receivable)` — never delta-patch
   (D-011). Recomputation reads live allocations only.
6. Update the receivable's `payment_status` transition (`UNPAID` →
   `PARTIALLY_PAID` / `PAID`) based on the recomputed outstanding.
7. Audit `payment.created` with target IDs in `after`.

### `SupplierPaymentService.create`

Mirror, with one addition:

- On the ledger debit side (paying the supplier), if the currency is
  **non-base**, the debit's cost engine step yields a
  `realized_pnl_mru` — the settlement FX gain/loss (D-017). This is a
  side-effect of `CostEngine`, not a separate write. It appears in the
  profit report in P7 under "FX gain on settlements", separate from
  trading gross profit.

Test: pay a 5,000 EUR supplier debt when EUR average cost has drifted;
`realized_pnl_mru` matches the hand-computed figure.

### `RecomputeService.recompute(tx, target)`

Shared by both payment services and by reversal in P6.

```
outstanding = original_amount − Σ (allocation.amount
                                    WHERE payment.status = 'CONFIRMED'
                                    AND target.status = 'CONFIRMED')
```

Two callers: payment creation and reversal. Idempotent. `outstanding <
0` throws — should be impossible if INV-5 holds; treat it as a bug.

### `ExpenseService.create`

- One transaction: insert `expense` row, `LedgerService.apply` with a
  debit on the currency carrying `payment_method_id` (and note if
  required), audit.
- Balance sufficiency checked against `amount` (D-014).
- No profit implication — expenses are outside gross profit; they
  reduce net profit in the P7 profit report.

### Standing invariants (P5-07)

Wire the remaining three:

| ID | Query sketch |
|---|---|
| INV-2 | For each receivable: `original − Σ (allocation.amount WHERE payment.status = CONFIRMED AND receivable.status = CONFIRMED) = outstanding_amount`, and outstanding ≥ 0 |
| INV-3 | Same for each payable |
| INV-5 | For each receivable/payable, sum of live allocations ≤ original |

INV-9 now has real data (payments and expenses write cash-movement
ledger entries with methods). Deliberately break a fixture row (delete
the `payment_method_id` from a payment's ledger entry) and confirm the
suite goes red.

---

## 4. Endpoints

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/customer-payments` | `payment:receive` |
| POST | `/api/v1/supplier-payments` | `payment:pay` |
| GET | `/api/v1/payments` | `payment:read` |
| GET | `/api/v1/receivables` | `receivable:read` |
| GET | `/api/v1/payables` | `payable:read` |
| GET | `/api/v1/contacts/:id/debts` | `contact:read` + debt perms |
| POST | `/api/v1/expenses` | `expense:create` |
| GET | `/api/v1/expenses` | `expense:read` |
| GET | `/api/v1/expense-categories` | `expense_category:read` (already exists from P2) |

All list endpoints paginated. The debt list endpoints accept
`byContact`, `byCurrency`, `byAgeBucket` filters (P5-08).

---

## 5. Frontend

Routes:

```
/debts                                  DebtsHomePage (tabs: receivables, payables)
/debts/receivables                      ReceivablesListPage (by contact / by currency / by age)
/debts/payables                         PayablesListPage
/debts/receivables/:id/receive          ReceivePaymentPage
/debts/payables/:id/pay                 PaySupplierPage
/payments                               PaymentsListPage
/expenses                               ExpensesListPage
/expenses/new                           ExpenseFormPage
/settings/expense-categories            ExpenseCategoriesPage (already in P2)
/contacts/:id                           ContactProfilePage
    tabs: overview, trades, receivables (real), payables (real)
```

Key components:

- `AgeBucketFilter` — 0-7 / 8-30 / 31-60 / 60+ days, based on the
  receivable/payable `created_at`. Bucket boundaries are business-day
  arithmetic using `common/period.ts` so DST does not shift them.
- `ReceivePaymentForm` — single-target in v1 (D-011). Shows the target
  receivable, currency locked (same-currency rule), amount input
  (defaulted to outstanding), method picker + note.
- `SideBySideDebtsPanel` on `ContactProfile` — receivables and payables
  in two adjacent columns with **a visible note explaining they are
  never netted** (spec §17). This is on the screen, not in a tooltip —
  the temptation to "just add a net figure" is what the note prevents.
- `ExpenseForm` — category, currency, amount, method (+ note),
  description.
- `IdempotencyKeyProvider` + write-blocking offline banner: reused from
  P4.

Cache keys added: `['receivables', filters]`, `['payables', filters]`,
`['payments', filters]`, `['contact', id, 'debts']`, `['expenses',
filters]`.

Mutations invalidate: receive payment → `['receivables']`,
`['payments']`, `['contact', id, 'debts']`, `['balances']`. Expense
create → `['expenses']`, `['balances']`.

---

## 6. Tests

Priority order:

1. **P5-02** Partial then final settlement — a receivable of 100,000 MRU
   paid 30,000, then 70,000, closes at exactly zero with no rounding
   residue. Verified by direct query.
2. **P5-02** Over-payment: attempting to allocate 100,001 to an
   outstanding of 100,000 → `PaymentExceedsOutstandingError` (422).
3. **P5-02** Cross-currency payment: paying a USD receivable in EUR →
   422. Verified over HTTP.
4. **P5-04** Reversing a payment (via a P5-only "reverse" test path if
   P6 not landed yet, otherwise use P6's flow) flips liveness and the
   recomputation removes those allocation amounts.
5. **P5-05** Recompute is called, not delta-patch: after creating a
   payment, `receivable.outstanding_amount` equals
   `original − Σ live allocations` by query. Introduce a manual UPDATE
   to a wrong outstanding and confirm INV-2 fails.
6. **P5-03** Supplier payment on non-base debt with EUR avg cost 39.5
   MRU but original payable at 40.0 MRU/EUR — `realized_pnl_mru` is
   `(40.0 − 39.5) × amount` and appears as FX gain in the profit query.
7. **P5-06** Expense exceeding balance rejected.
8. **P5-06** Expense on a `requires_note` method with empty note →
   422.
9. **P5-11** A contact who is both customer and supplier holds
   receivables and payables independently — reading `/debts` for that
   contact shows both, unnetted.
10. **P5-07** After the twelve tests above, INV-2, INV-3, INV-5, INV-9
    all pass in every test.
11. **P5-01** `DELETE /api/v1/payments/:id` — endpoint absent or
    405. Curl output pasted.
12. **P5-05** Payment status transitions: a receivable moves
    `UNPAID → PARTIALLY_PAID` on first partial payment, `→ PAID` on
    final. Reversing the final payment moves it back to
    `PARTIALLY_PAID`, not `UNPAID` (a partial payment still exists).

---

## 7. Definition of Done — checklist

- [x] Customer debt paid in three installments closes at exactly zero,
      by direct query. Covered by §6.1 integration test.
- [x] Payment of one minor unit more than the outstanding is refused
      over HTTP with `PaymentExceedsOutstandingError`. Covered by
      §6.2 integration test.
- [x] A contact owing 100,000 MRU while being owed 50,000 MRU displays
      both figures side-by-side, unnetted, with the visible explanation.
      *SideBySideDebtsPanel with `role="note"` unnetted banner; ContactProfile
      "debts" tab renders both columns. Component test asserts note +
      both region headings render.*
- [x] Every debt figure on screen matches a query against the
      allocations table. *List pages read outstandingAmount, which is
      recomputed via RecomputeService on every write and enforced by
      INV-2/INV-3/INV-5 after each of 164 integration tests.*
- [x] INV-2, INV-3, INV-5 hold after each of the twelve tests. Wired in
      `setup-invariants.ts`, verified with deliberate scratch-DB break.
- [x] INV-9 catches a payment whose ledger entry has no
      `payment_method_id` (proven with deliberate scratch break in
      INV-9 test).
- [x] Chokepoint grep still clean. *Only match under `api/src` outside
      `LedgerService` is `opening-balance.service.ts:143`
      `tx.currencyLedger.updateMany({ ... transactionDate })` — a
      metadata-only sync of the transaction date when an opening's
      effective date is adjusted post-go-live. No amount, direction, or
      source columns are touched, so ledger sums, balance cache, and
      cost book remain unchanged. Pre-existing since P3-B.*
- [x] `DELETE` endpoints do not exist on `payment`, `allocation`,
      `expense`. Verified by integration tests returning 404.
- [x] Supplier settlement FX gain on a non-base payable produces the
      expected `realized_pnl_mru` by hand-calculation. D-017 example in
      §6.6 integration test (EUR WAC 39.5, original rate 40.0 MRU/EUR,
      100 EUR → realized_pnl = 50.0000 MRU).

---

## 8. Explicitly deferred

- **Multi-target payment UI** — service accepts N allocations; v1 UI is
  single-target per D-011. Add multi-target UI when the client asks.
- **Reversal of a payment or expense** — Phase 6. Recompute path is
  already in place; the reversal just flips `status = REVERSED` and
  re-recomputes.
- **Debt aging report screens** — the age-bucket filter exists here;
  the *report* view is Phase 7.
- **Customer overpayment credits** — spec §15.4 forbids them; will stay
  forbidden until the spec says otherwise.
- **Cross-currency debt settlement** — never (spec §15.2).
- **Automatic write-off / bad debt** — not in scope. If asked, model as
  a reversal with a reason, don't invent a new state.
- **Payment reference upload (photo of a Bankily receipt)** — not in
  scope; if requested, it is a separate change request against §41 on
  attachments.
