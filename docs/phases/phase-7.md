> **Status: shipped 2026-08-13** via `feat/phase-7`. All ten DoD boxes green,
> 188/188 integration tests, chokepoint grep clean. `/reports/dashboard`,
> `/reports/cash-flow`, `/reports/ageing` all live with CSV export.

# Phase 7 — Dashboard & operational reports (Detail)

Scope: tasks P7-01 → P7-07.
Milestone: **v4** — the operator has a real-time operational overview
and can reconcile cash by payment method.

Goal: the dashboard shows the operator what matters right now (today's
activity, open debts, low-balance warnings). The new reports let them
reconcile Bankily/Masrivi/Sedad statements, analyse debt ageing, and
export data to a spreadsheet.

Phase 7 is **entirely read-only** on the ledger. No new writes to
`currency_ledger`, `currency_balance`, `cost_movement`, or
`currency_cost`. The chokepoint grep must stay clean without touching
new code paths.

---

## 0. Hard gate

Phase 6's DoD must pass:

- All reversals green, `api/scripts/check-invariants.ts` reports OK.
- Profit report on §44 fixture: gross 8,000 MRU, net 8,000 MRU.
- Chokepoint grep clean.
- `feat/phase-6` squash-merged to `main`. (**Done 2026-08-12.**)

---

## 1. PR structure

One branch (`feat/phase-7`), one PR. Phase 7 is read-only so the blast
radius is low and there is no reason to split.

---

## 2. Migrations

**None.** `currency.low_balance_threshold` (spec §22.3) already exists
from P2. No new columns, no new tables.

---

## 3. Core services

### `DashboardService` (P7-01)

New service in `src/reports/`. Read-only. One method:

```ts
dashboard(today: Date): Promise<DashboardSummary>
```

Where `today` is the start of the current calendar day in the
business timezone (via `common/period.ts`).

`DashboardSummary`:
- `todayPurchases: { count: number; totalMru: string }`
- `todaySales: { count: number; totalMru: string }`
- `todayNetMru: string`  (totalSalesMru − totalPurchasesMru)
- `openReceivables: { count: number; totalMru: string }`
- `openPayables: { count: number; totalMru: string }`
- `lowBalanceCurrencies: Array<{ code: string; cachedAmount: string; threshold: string }>`

All MRU totals sum the **base-currency leg** of each trade (the
`payment_total` for sales, the `payment_total` for purchases where the
payment currency is MRU). Status filter: `CONFIRMED` only.

`openReceivables` sums `outstanding_amount` for receivables with
`status = CONFIRMED`, grouped by the receivable's `currency_id` IF the
currency is MRU; for non-MRU receivables the outstanding is already
tracked in a foreign currency and cannot be meaningfully summed into an
MRU total without a stored rate. **Summation is over MRU-denominated
receivables only**; the response includes a `hasNonMruDebts: boolean`
flag when non-MRU debts exist so the frontend can note they are omitted
(rule 6 — never add across currencies, conventions §8).

`lowBalanceCurrencies` compares `currency_balance.cached_amount` against
`currency.low_balance_threshold` for every active non-base currency where
a threshold is configured and `cached_amount ≤ threshold`.

### `CashFlowService` (P7-02)

New service in `src/reports/`. Groups ledger entries by payment method
and direction over a period, building the Bankily/Masrivi/Sedad
reconciliation report (D-020).

```ts
cashFlow(from: Date, to: Date): Promise<CashFlowReport>
```

`CashFlowReport`:
- `from`, `to`
- `methods: Array<CashFlowMethodRow>`
  - `paymentMethodId: string`
  - `paymentMethodName: string`
  - `creditsTotal: string`  (CREDIT direction)
  - `debitsTotal: string`   (DEBIT direction)
  - `netTotal: string`      (credits − debits, signed)
- `grandCreditsTotal: string`
- `grandDebitsTotal: string`

Query: `SELECT payment_method_id, direction, SUM(amount)` from
`currency_ledger` where `payment_method_id IS NOT NULL` and
`transaction_date >= from AND < to` and `is_active = true`.

**Important:** this sums in the currency of each leg, not in MRU — that
would violate rule 6. When a single payment method is used across
multiple currencies, the report groups by
`(payment_method_id, currency_id)` and returns one row per pair, not
aggregated. The frontend renders a table with currency columns. This
prevents silent cross-currency addition.

Response shape for `methods`:
```ts
{
  paymentMethodId: string;
  paymentMethodName: string;
  byLeg: Array<{
    currencyCode: string;
    creditsTotal: string;
    debitsTotal: string;
  }>;
}
```

Permission: `REPORT_VIEW` (employees can reconcile cash).

### `AgeingReportService` (P7-03)

New service in `src/reports/`. Aggregates open receivables and payables
into age buckets — different from the per-row age filter on the debts
list pages.

Buckets are defined by `daysFromNow` cutoffs:
- `current`: created ≤ 30 days ago
- `bucket31to60`: 31–60 days
- `bucket61to90`: 61–90 days
- `bucket91plus`: > 90 days

Age is computed from `created_at` (the row's creation date, not
`transaction_date` — we want collection age, not deal age).

```ts
ageing(now: Date): Promise<AgeingReport>
```

`AgeingReport`:
- `receivables: AgeingSection`
- `payables: AgeingSection`

`AgeingSection`:
- `current: { count: number; currencies: Array<{ code: string; total: string }> }`
- `bucket31to60: { ... }`
- `bucket61to90: { ... }`
- `bucket91plus: { ... }`

Separate per currency rather than summing to MRU. Status: `CONFIRMED`
only (reversed/closed debts are not outstanding).

Permission: `REPORT_VIEW`.

---

## 4. Endpoints

New routes added to `ReportsController`:

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/dashboard/summary` | `balance:read` | Any logged-in employee with `balance:read` |
| GET | `/api/v1/reports/cash-flow` | `report:view` | Period filters: `from`, `to` |
| GET | `/api/v1/reports/ageing` | `report:view` | No filters — always current day |

CSV streaming: all three endpoints accept `?format=csv`. When present,
the response is `Content-Type: text/csv; charset=utf-8` with
`Content-Disposition: attachment; filename=<report>-<date>.csv`. The
NestJS controller uses `StreamableFile` over a `Readable` pipe — no
in-memory accumulation.

`GET /dashboard/summary` lives under a new `DashboardModule` (thin
wrapper, imports `LedgerModule` and `ReportsModule`). The existing
`/balances` endpoint covers the low-balance detail; the dashboard
summary adds the operational totals and the count of currencies below
threshold.

---

## 5. Frontend

### Routes

```
/reports/cash-flow             CashFlowReportPage   (P7-06)
/reports/ageing                AgeingReportPage     (P7-06)
```

### DashboardShell update (P7-05)

Replace the current button-link strip with a two-section layout:

**Summary strip** — three cards side-by-side:
- "Today's purchases": count + total MRU.
- "Today's sales": count + total MRU.
- "Net today": signed MRU.

**Open debts mini-panel** — two rows:
- Receivables: count + MRU total (with "non-MRU debts excluded" note if applicable).
- Payables: count + MRU total.

Low-balance warnings (already rendered per currency in `BalancesCard`)
are also surfaced as a compact chip list at the top of the dashboard
when `lowBalanceCurrencies.length > 0`.

Action links (balances, openings, reports) move to a grid below the
summary.

`useDashboardSummary()` hook — `['dashboard', 'summary']` cache key,
`staleTime: 60_000` (1 minute) — the dashboard summary is not expected
to be real-time.

### CashFlowReportPage (P7-06)

Period filter (from/to dates). Table: one row per payment method + currency
pair. Columns: method, currency, credits, debits. Totals row at the
bottom per currency. CSV download button — `window.location.href` to
`/api/v1/reports/cash-flow?from=&to=&format=csv`.

### AgeingReportPage (P7-06)

Two sections (receivables / payables). Each section is a table with
columns: bucket label, count, per-currency amounts. Currency columns
are dynamic (one column per distinct currency with outstanding debts in
that bucket).

### i18n

New keys in both `ar` and `fr`:

- `dashboard.today_purchases`, `dashboard.today_sales`, `dashboard.net_today`
- `dashboard.open_receivables`, `dashboard.open_payables`
- `dashboard.low_balance_warning` (singular and plural via `_count` variant)
- `dashboard.non_mru_debts_excluded`
- `reports.cash_flow_title`, `reports.method`, `reports.credits`,
  `reports.debits`, `reports.net`
- `reports.ageing_title`, `reports.bucket_current`, `reports.bucket_31_60`,
  `reports.bucket_61_90`, `reports.bucket_91_plus`
- `common.download_csv`

Cache keys: `['dashboard', 'summary']`, `['reports', 'cash-flow', filters]`,
`['reports', 'ageing']`.

---

## 6. Tests

Integration tests in `api/test/integration/reports.integration.test.ts`.

Priority:

1. **P7-01** Dashboard summary reconciles against direct queries: seed
   two confirmed purchases + one confirmed sale all dated today, assert
   `todayPurchases.count = 2`, `todaySales.count = 1`, `todayNetMru`
   equals the expected difference. Reversed trades excluded.

2. **P7-01** Low-balance: seed a currency with
   `low_balance_threshold = 500`, set its `cached_amount` via an
   opening balance of 400. Assert `lowBalanceCurrencies` contains it.
   Seed another at 600, assert it is absent.

3. **P7-02** Cash-flow reconciliation: seed a purchase (cash in via
   BANKILY), a sale (cash in via CASH), a supplier payment (cash out via
   BANKILY). Directly sum `currency_ledger` by
   `(payment_method_id, direction, currency_id)` and compare against
   `GET /reports/cash-flow` response. Assertion: service totals equal
   direct ledger sums — this is the primary P7 invariant.

4. **P7-02** Cash-flow excludes inactive (reversed) movements: reverse
   the BANKILY purchase, assert its contribution disappears from the
   cash-flow report. Direct ledger sum of active rows matches.

5. **P7-03** Ageing buckets: seed one receivable created > 90 days ago
   (backdated `created_at` via raw SQL after insert), one created 45
   days ago, one created today. Assert the three land in distinct
   buckets. Direct count of `receivable` rows in each date range matches
   the report.

6. **P7-03** Employee access: `REPORT_VIEW` permission — employee can
   call cash-flow and ageing. `PROFIT_VIEW`-only endpoints still return
   403 for employees.

7. **P7-02 / P7-03** No cross-currency summation: if a currency other
   than MRU has ledger entries with a payment method, the cash-flow
   report shows that currency as a separate column and does not add its
   amount to the MRU total. Directly assert the response shape has
   `byLeg` items with distinct `currencyCode` values rather than a
   single summed total.

---

## 7. Definition of Done — checklist

- [x] Dashboard summary totals match direct SQL counts on the seeded
      fixture (P7-01, §6.1).
- [x] Low-balance chip appears for currencies below threshold and is
      absent for those above (P7-01, §6.2).
- [x] Cash-flow report totals equal a direct `SUM(amount) … GROUP BY`
      on `currency_ledger` with matching filters (P7-02, §6.3). This is
      the reconciliation invariant.
- [x] Reversed movements contribute zero to the cash-flow report (P7-02,
      §6.4).
- [x] Ageing buckets reconcile against direct date-range queries on
      `receivable`/`payable` (P7-03, §6.5).
- [x] `?format=csv` returns valid CSV with the correct `Content-Type`
      and `Content-Disposition` headers (manual curl check; no browser
      needed).
- [x] Employee with `REPORT_VIEW` reaches cash-flow and ageing; 403 on
      profit report. Curl assertion in §6.6.
- [x] No cross-currency addition anywhere in new service code (rule 6,
      conventions §8). Cash-flow `byLeg` is the guard.
- [x] Chokepoint grep still clean — no write to `currency_ledger`,
      `currency_balance`, `cost_movement`, `currency_cost` outside
      `LedgerService`.
- [x] Both AR and FR i18n keys present. Dashboard summary, cash-flow,
      and ageing pages rendered in RTL.

---

## 8. Explicitly deferred

- **Per-purchase/sale/expense report pages** — the existing list pages
  (`/purchases`, `/sales`, `/expenses`) already paginate. A separate
  "report" view with aggregate header is a UX polish pass, not a new
  data surface. Deferred to Phase 8.
- **Contact debt summary widget** — the contact profile already links to
  receivables/payables list. A summary total widget belongs in a UX
  pass, not here.
- **Scheduled CSV email** — out of scope (no email infra, spec §47).
- **Period-over-period comparison** — delta vs prior period on dashboard.
  Deferred; no spec item.
- **Rate-snapshot chart** — market rate history visualization (spec §23.8).
  Deferred to the rates phase (P8).
- **Timezone-aware bucket boundaries for ageing** — age is computed in
  UTC for now. Mauritania is UTC+0 (no DST) so the difference is zero,
  but the setting exists for future correctness.
