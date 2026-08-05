# Currency Exchange System — Task Board

Stack: NestJS + Prisma + PostgreSQL · React + Vite PWA · Docker Compose on VPS

Conventions:
- Each task is sized for one person, roughly 0.5–2 days.
- `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
- A phase is done only when its **Definition of Done** passes — not when the UI
  merely exists. The DoD is never softened to match what got built; shortfalls
  are back-filled.
- Task IDs `P<phase>-<number>` appear in branch names and commits:
  `feat(P4-03): sale service with cost disposal`

The eight phases are grouped into three release milestones. A milestone is
reached only when **every** Definition of Done inside it has passed — the
milestone banner does not lower the phase gates, it just names what the outside
world gets to see.

| Milestone | Phases | What it delivers |
|---|---|---|
| **v1** — presentable auth + basics | P1 · P2 | Bilingual PWA on the VPS, login, roles, master data, schema signed off. No money moves yet. |
| **v2** — dangerous core landed (~60–70%) | P3 · P4 · P5 | Ledger, trades, debts, expenses. §44 green in CI. No reports, no reversal, no rate feed. |
| **v3** — deployment ready | P6 · P7 · P8 | Reversal, profit, dashboard, rate integration, backups proven restorable, handover. |

---

# Milestone v1 · Presentable auth + basics

Scope: Phases 1 – 2. The client can log in on a phone, in Arabic or French,
manage users, currencies, contacts, and payment methods, and see the shape of
the app. **No financial writes exist yet** — the ledger tables don't ship until
P3. That is deliberate: the schema review (P2-13) is the gate between "we can
demo the shell" and "we are committing to an irreversible data model."

Exit for v1: DoD of Phase 1 **and** Phase 2 both pass, with the schema review
signed off. Anything less and v2 starts on unstable ground.

---

## Phase 1 — Foundation
Goal: a deployed, authenticated, bilingual shell that a user can log into on a
phone, with roles enforced server-side and every sensitive action already
landing in the audit log.

### Setup
- [x] P1-01 Monorepo, workspaces, TypeScript strict, ESLint + Prettier, CI running lint + typecheck + tests
- [x] P1-02 Docker Compose for local dev (Postgres + API + web), `.env.example`, config module with schema validation
- [x] P1-03 Prisma init, first migration, seed script skeleton

### Backend
- [x] P1-04 User, Role, Permission schema; permission strings enumerated in one place
- [x] P1-05 Auth: phone + PIN login, argon2 hashing, JWT in httpOnly cookie, sliding session, logout
- [x] P1-06 Login rate limiting and lockout after repeated failures
- [x] P1-07 `@RequirePermission` guard, fail-closed by default; unit test enumerating the route table asserts no route lacks a decorator
- [x] P1-08 Audit log table + `AuditService`; wired to login, failed login, user create, user deactivate, permission change
- [x] P1-09 Domain error base class, HTTP exception filter, i18n key mapping, no stack traces on the wire
- [x] P1-10 `common/money.ts` (Decimal helpers, `roundTo`) and `common/period.ts` (timezone-aware boundaries) with unit tests

### Frontend
- [x] P1-11 Vite + React app shell, router, layout with bottom nav sized for one-handed phone use
- [x] P1-12 API client with cookie auth, error → i18n mapping, global 401 handling
- [x] P1-13 i18n setup (AR + FR), language switcher, `dir` switching, logical-property CSS baseline
- [x] P1-14 Login screen, session guard, logout
- [x] P1-15 PWA: manifest, service worker, installability, offline banner component (banner only; write-blocking arrives with the first form)

### Ops
- [x] P1-16 Deploy to VPS behind Traefik with TLS; document the deploy command in README

**Definition of Done:** the app is reachable over HTTPS on the VPS and installs
to a phone home screen; a user with no permissions receives 403 from a protected
endpoint **called directly with curl**, not merely a hidden button; a route added
without a permission decorator fails the route-table test; login, failed login,
and a permission change appear as audit rows read from the database; the UI has
been operated end-to-end in Arabic with correct RTL layout on a real phone; CI is
green on lint, typecheck, and tests.

---

## Phase 2 — Master data & the schema review
Goal: everything the financial core depends on exists and is editable, and the
full remaining schema has been reviewed on paper before the first irreversible
migration.

### Backend
- [x] P2-01 Currency CRUD: code, name, symbol, `decimal_places`, active flag, low-balance threshold; deactivate-not-delete enforced by a usage check
- [x] P2-02 Settings module: base currency, business timezone, negative-balance policy, go-live flag
- [x] P2-03 Contact CRUD with `is_customer` / `is_supplier` flags, archive-not-delete, duplicate-phone **warning** (not a block, spec §10.3)
- [x] P2-04 Expense category CRUD
- [x] P2-05 Payment method lookup: seeded with Cash / Bankily / Masrivi / Sedad / Other, with `is_active` and `requires_note`; owner can add and deactivate, never delete (D-020)
- [x] P2-06 User management: create, deactivate, admin PIN reset, role assignment
- [x] P2-07 Audit wiring for currency, contact, settings, and user changes

### Frontend
- [x] P2-08 Currency list + form, including a clear `decimal_places` explanation
- [x] P2-09 Contact list with search and filters, contact form, duplicate warning UI
- [x] P2-10 Contact profile shell — tabs present, financial tabs visible but empty with "arrives in Phase 4/5" placeholders
- [x] P2-11 Users, roles, and permission matrix screens
- [x] P2-12 Settings screen, including the payment method list

### Gate
- [x] P2-13 **Schema review document** (`docs/schema-review.md`): every remaining table through Phase 7 laid out on paper — ledger, cost movements, purchases, sales, receivables, payables, payments, allocations, expenses, openings, rate snapshots — with the raw-SQL constraints Prisma can't express, deliberate deviations from the spec with reasoning, and paste-ready `D-0xx` entries. Ends in a sign-off checklist. **Signed off 2026-08-04 — see D-023 for §9 resolutions.**

**Definition of Done:** a currency used by nothing can be deactivated but never
deleted, proven over HTTP; two contacts with the same phone can both be created
after a warning; the base currency and business timezone are read from settings
by `common/period.ts`, not from a constant; P2-13 is signed off and every
question it raised is either an accepted `D-0xx` entry or an explicit Pending one
with a named owner; **no migration creating a financial table has been written
yet.**

---

# Milestone v2 · Dangerous core landed (~60–70%)

Scope: Phases 3 – 5. The financial machinery — ledger chokepoint, cost engine,
trades, debts, expenses. Every table in `docs/schema-review.md` that carries
money exists after this milestone. The spec §44 acceptance scenario runs green
in CI, verified **by reading Postgres, not the UI**.

Not yet included: reversal (P6), profit/dashboard/reports (P6–P7), the market
rate feed (P8), production hardening (P8). The app is functionally usable by an
internal tester who knows not to make mistakes; it is not yet resilient to them.

Exit for v2: DoD of Phase 3, Phase 4, and Phase 5 all pass, all eight
invariants are green after every test, and the chokepoint grep (§3.3) is clean.

---

## Phase 3 — The ledger core
Goal: balances exist, are derived from an append-only ledger, can only be changed
through one code path, survive concurrent writers, and are proven correct by
opening balances — the system's first and safest ledger writer.

> **PR split (mandatory).** PR-A: migration + `LedgerService` + `CostEngine` +
> service-level tests, **no UI**. PR-B: opening-balance endpoints and screens.
> Reviewing a 400-line locking transaction is possible; reviewing it inside a
> 2,000-line PR with forms and translations is theatre.

### PR-A — core
- [x] P3-01 Migration: `currency_ledger`, `currency_balance`, `cost_movement`, `currency_cost`, with CHECK constraints added as raw SQL and eyeballed in the generated file
- [x] P3-02 `LedgerService.apply(tx, movements[])`: required `tx`, sorted `FOR UPDATE` locking, pre-write validation, ledger insert, balance-cache update; `Movement` carries an optional `paymentMethodId` persisted onto the entry (D-020)
- [x] P3-03 Negative-balance policy: blocked by default, owner-only override with mandatory reason, refused entirely for non-base currencies (D-015), audit-logged
- [x] P3-04 `CostEngine`: acquisition at MRU value, disposal at weighted average, realized gain/loss, ordered by ledger sequence not transaction date (D-008)
- [x] P3-05 Balance and cost read APIs (per currency, all currencies, last movement date)
- [x] P3-06 Standing invariants INV-1, INV-4, INV-6, INV-8, INV-9 wired into the suite's global `afterEach`
- [x] P3-07 Tests: single movement; multi-currency batch; insufficient balance rejection with useful error data; override accepted for base and refused for non-base; **two concurrent operations against the same balance, one must lose**; rollback leaves no partial ledger

### PR-B — opening balances
- [x] P3-08 Opening currency balances: quantity + opening average cost + effective date, written through `LedgerService`
- [x] P3-09 Opening customer and supplier debts with `origin = OPENING` and null source (D-010)
- [x] P3-10 Go-live lock: opening entries editable only while the go-live flag is unset; afterwards owner-authorized adjustments only
- [x] P3-11 Opening balance screens and the balances dashboard card
- [x] P3-12 `api/scripts/check-invariants.ts` runnable standalone against any database

**Definition of Done:** a grep over every write site for `currency_ledger`,
`currency_balance`, `cost_movement`, and `currency_cost` — **including raw SQL,
checked for both Prisma and snake_case table naming** — shows every one inside
`LedgerService`, and the grep output is pasted into the PR; two concurrent
requests spending the same balance leave the balance correct and one request
rejected; the eight invariants pass in every test; a manual `UPDATE` attempt
setting a non-base balance negative is refused by the database, not just the
service; opening balances entered by hand match the ledger sum read directly from
Postgres.

---

## Phase 4 — Trades
Goal: purchases and sales, fully and partially paid, correct in balances, cost
basis, and profit — including cross-pair trades with no MRU leg.

> **PR split (mandatory).** PR-A: migration + purchase/sale services + tests, no
> UI. PR-B: forms, lists, detail screens.

### PR-A — core
- [x] P4-01 Migration: `purchase`, `sale`, `receivable`, `payable`, with split lifecycle/payment status enums (D-013)
- [x] P4-02 `PurchaseService.create`: one transaction covering the purchase row, acquisition of the received currency, disposal of the immediate payment, payable for the outstanding, audit entry
- [x] P4-03 `SaleService.create`: the mirror, plus `cost_of_currency_sold` and `gross_profit` snapshotted at confirmation
- [x] P4-04 Base-leg rule (D-019): reject a trade with zero or two base-currency legs; server derives rate from total or total from rate, rounding per D-009
- [x] P4-04b Payment method captured on the immediate-payment leg of both purchases and sales; note required when the method demands one (D-020)
- [x] P4-05 Validation set per spec §11.5 / §12.4, with sufficiency checked against the cash actually moving (D-014)
- [x] P4-06 Idempotency keys on trade creation; repeat key inside the window returns `DuplicateSubmissionError`
- [x] P4-07 Invariant INV-7 added; the §44 acceptance scenario wired as a fixed CI fixture
- [x] P4-08 Tests: fully paid purchase; partially paid purchase; unpaid purchase; the three sale equivalents; **a trade with no base-currency leg is rejected**; weighted average across two purchases at different rates; insufficient balance; inactive currency; rate/total consistency; rollback on a mid-transaction failure

### PR-B — interface
- [ ] P4-09 Purchase form with unmistakable rate direction ("1 USD = 39.00 MRU"), live total preview, and a reversed-rate sanity warning
- [ ] P4-10 Sale form, same treatment, plus recipient and destination fields
- [ ] P4-11 Purchase and sale lists with the spec §24 filter set, server-side pagination
- [ ] P4-12 Trade detail screens showing value, cash moved, and outstanding as three separate figures
- [ ] P4-13 `profit:view` stripping proven absent from the HTTP response for an employee role (D-018)
- [ ] P4-14 Contact profile financial tabs populated

**Definition of Done:** the spec §44 scenario runs green in CI with every figure
matched **by reading Postgres, not the UI** — including the 39.00 average cost and
the 8,000 MRU gross profit; a trade submitted with no MRU leg is refused over HTTP
rather than accepted with an inferred rate; a partially paid sale shows sale value, cash collected, and
receivable as three distinct numbers on screen; double-tapping save on a real
phone with a flaky connection creates exactly one sale; an employee without
`profit:view` receives a sale payload with no profit fields, verified with curl;
the chokepoint grep is re-run and pasted.

---

## Phase 5 — Debts, settlements & expenses
Goal: debts can be paid down over time, from either side, and operating expenses
reduce balances correctly.

- [ ] P5-01 Migration: `payment`, `allocation`, `expense` (D-011)
- [ ] P5-02 `CustomerPaymentService`: one payment, N allocations, oldest-first default, same-currency rule enforced, overpayment blocked (spec §15.4)
- [ ] P5-03 `SupplierPaymentService`: the mirror, plus the settlement FX gain/loss on non-base payables (D-017)
- [ ] P5-04 Derived allocation liveness — an allocation counts iff its payment and its target are both active
- [ ] P5-05 Receivable and payable status transitions driven by recomputation, never by delta patching
- [ ] P5-06 `ExpenseService` with category, currency, balance check, ledger write, payment method
- [ ] P5-07 Invariants INV-2, INV-3, INV-5 wired in; INV-9 now has real data to bite on
- [ ] P5-08 Debt list screens: by contact, by currency, by age bucket (0–7 / 8–30 / 31–60 / 60+)
- [ ] P5-09 Receive-payment and pay-supplier forms, single-target in v1 per D-011, with the payment method picker and conditional note field
- [ ] P5-10 Expense list and form; expense categories screen
- [ ] P5-11 Contact profile: receivables and payables shown **side by side and never netted**, with a visible note explaining why
- [ ] P5-12 Tests: partial then final settlement; over-payment rejection; payment in the wrong currency rejection; a contact who is simultaneously customer and supplier keeps both balances separate; expense exceeding balance rejected; non-base payable settlement produces the expected FX gain

**Definition of Done:** a customer debt paid in three installments closes at
exactly zero with no rounding residue; a payment of one minor unit more than the
outstanding is rejected over HTTP; a contact owing 100,000 MRU while being owed
50,000 MRU displays both figures unnetted; every debt figure on screen matches a
query against the allocations table; INV-2, INV-3, and INV-5 hold after each of
the twelve tests.

---

# Milestone v3 · Deployment ready

Scope: Phases 6 – 8. Reversal (D-016 resolved by D-021 — recompute and restate),
full profit and dashboard reports, the market rate feed, security review,
automated off-server backups **with a restore rehearsal that actually restored**,
and the handover artefacts.

Exit for v3: DoD of Phase 6, Phase 7, and Phase 8 all pass, spec §49 is ticked
with evidence, and the owner has completed a partially paid sale on a phone
without help.

---

## Phase 6 — Profit, reversal & audit
Goal: profit is reportable and correct, and a mistake made yesterday can be
undone today without corrupting anything.

> D-016 resolved by D-021 (2026-08-01): trade reversal uses recompute-and-restate.
> P6-04 is unblocked.

- [ ] P6-01 Profit engine: gross profit by period and by currency, cost of currency sold, realized FX gain, net profit after expenses (spec §19.4)
- [ ] P6-02 Base-currency consolidation using stored snapshot rates only — never a live rate (spec §20)
- [ ] P6-03 Reversal of expenses and payments: compensating ledger entries, status flip, mandatory reason, allocation liveness cascade
- [ ] P6-04 Reversal of trades, per the D-016 resolution, with forward recomputation of the cost engine
- [ ] P6-05 Reversal permission is owner-only and separately audited
- [ ] P6-06 Audit log viewer with entity, actor, before/after, reason; owner-only
- [ ] P6-07 User activity report (spec §23.10)
- [ ] P6-08 Tests: reverse a fully paid sale; reverse a partially paid purchase with settlements against it; **the invariants still hold after every reversal**; reversal is idempotent when replayed; a reversed transaction contributes nothing to any report

**Definition of Done:** reversing a partially settled purchase restores the
payable, the balance, and the cost basis to values verified by direct query;
reversal is refused for a user without the permission, proven over HTTP; every
reversal has a non-empty reason in the audit log; running the invariant script
after the full reversal test suite reports clean; a reversed trade is absent from
every report but still visible in history.

---

## Phase 7 — Dashboard & reports
Goal: the owner can answer all fourteen questions in spec §2 from a phone.

- [ ] P7-01 Shared report query layer: period + currency + contact filters, one active-status filter used everywhere
- [ ] P7-02 Dashboard cards (spec §22.3), period filter, currency filter
- [ ] P7-03 Balance panel with low-balance warnings and last movement date
- [ ] P7-04 Debt summary: totals by currency, top debtors, top creditors
- [ ] P7-05 Recent activity feed
- [ ] P7-06 Currency balance, purchase, and sales reports
- [ ] P7-07 Receivable and payable reports with ageing
- [ ] P7-08 Cash-in and cash-out reports — actual movements only, never transaction values — with a breakdown by payment method for reconciling against Bankily / Masrivi / Sedad statements
- [ ] P7-09 Profit report and expense report
- [ ] P7-10 CSV export, generated server-side and streamed
- [ ] P7-11 Tests: every report reconciles against the ledger for a seeded fixture month; a consolidated total appears only in the base currency, never as a sum across currencies

**Definition of Done:** each of the fourteen questions in spec §2 is answerable
in under three taps from the dashboard; cash-in totals equal the sum of active
inbound ledger entries for the period, by query; the per-method breakdown sums
to the cash-in total exactly; switching to "all currencies"
never displays a figure that added two currencies together; the dashboard loads
in under three seconds on a phone over mobile data; every report is paginated and
the browser never receives more than a page.

---

## Phase 8 — Rates, hardening & handover
Goal: production-ready, backed up, and proven restorable.

- [ ] P8-01 Market rate provider integration, cached, with last-updated timestamp
- [ ] P8-02 Rate fetch failure is non-blocking: stale data shown with its age, transactions still creatable (spec §21.3)
- [ ] P8-03 Rate reference screen with optional owner buy/sell rates
- [ ] P8-04 Security review: headers, CSRF posture, rate limits, dependency audit, secret scan of the frontend bundle
- [ ] P8-05 Performance: index review against the actual filter set, slow-query log review under seeded volume
- [ ] P8-06 Automated nightly backup with retention and off-server copy
- [ ] P8-07 **Restore rehearsal** into a scratch database, timed and documented
- [ ] P8-08 Structured logging and error reporting in production
- [ ] P8-09 Mobile usability pass on real devices, both languages, one-handed
- [ ] P8-10 Handover: operations runbook, owner training notes, go-live checklist

**Definition of Done:** the rate provider being switched off for a day changes
nothing except a stale-data badge; a backup taken today has been restored into an
empty database and the invariant script reports clean against it; the frontend
bundle contains no secret, verified by grep; someone who has never seen the app
completes a partially paid sale on a phone without help; every item in spec §49
is ticked with evidence.

---

## Standing rules (apply to every task)

1. Every currency movement goes through `LedgerService.apply(tx, movements[])`.
   Nothing else writes to the ledger, balance, or cost tables.
2. Every financial operation is one database transaction. Partial success is not
   a representable state.
3. No financial record is ever deleted. Reversal is the only undo, and it
   recomputes rather than patches.
4. Money is `NUMERIC` in Postgres and `Decimal` or `string` in code. Never a
   JavaScript `number`.
5. Permissions are enforced by the API. A hidden button is not a permission
   check, and the test must prove it over HTTP.
6. Amounts in different currencies are never added together. Consolidation
   happens only in the base currency, only via stored snapshot rates.
7. Every purchase and sale has exactly one base-currency leg. A trade without
   one is rejected, never converted with an inferred rate.
8. A Definition of Done is never edited to match what got built. Back-fill the
   work instead.
9. Work deferred twice is not deferred a third time — it becomes a hard gate in
   the next phase document.
