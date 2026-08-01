> ⚠️ **Draft written blind.** Generated before Phase 1 closed out. Captures the
> best current plan, but earlier phases will surface things this document did
> not anticipate. Refine in the week before Phase 2 starts — do not treat it
> as final.

# Phase 2 — Master data & the schema review (Detail)

Scope: tasks P2-01 → P2-13.
Milestone: **v1**.

Goal: everything the financial core depends on exists and is editable, and
the full remaining schema has been reviewed on paper before the first
irreversible migration lands. The climax of Phase 2 is P2-13 — every earlier
task is CRUD that unblocks the schema review; the schema review is the gate
between "we can demo a shell" and "we are committing to a data model that
carries money."

---

## 0. Hard gate

Phase 1's DoD must pass in full before P2-01 opens. Concretely:

- Route-table introspection test (P1-07) is running in CI and green.
- Login, failed login, and a permission change have appeared as real rows in
  `audit_log`, read by `SELECT`.
- i18n parity test is green.
- The VPS deploy command was executed at least once — the README is not
  fiction.

Any P1 task carried into P2 becomes a **hard blocker** on its P2 dependents:
P2-06 (user management) leans on P1-04/07/08; P2-07 (audit wiring) leans on
P1-08. Do not open those P2 tasks until their P1 parents are ticked.

---

## 1. PR structure

Four PRs, none individually dangerous — no financial writes exist yet:

- **PR-1** (P2-01, P2-02, P2-05): Currency, settings, payment methods.
- **PR-2** (P2-03, P2-04, P2-06, P2-07): Contact, expense category, user
  management, audit wiring.
- **PR-3** (P2-08 → P2-12): Frontend forms and lists.
- **PR-4** (P2-13): the schema review. This is a **documentation PR** with a
  mandatory second reviewer. It ships on its own — no code interleaved.

P2-13's PR is the single artefact that gates v2.

---

## 2. Migrations

Two migrations expected. Neither touches money.

### `20260805_add_master_data`

Tables:

| Table | Columns of note |
|---|---|
| `currency` | id UUID, code TEXT UNIQUE (ISO 4217), name TEXT, symbol TEXT NULL, `decimal_places` SMALLINT, `low_balance_threshold` NUMERIC(24,4) NULL, `is_active` BOOL, timestamps |
| `contact` | id UUID, name TEXT, phone TEXT NULL, `is_customer` BOOL, `is_supplier` BOOL, `is_archived` BOOL, notes TEXT NULL, timestamps |
| `expense_category` | id UUID, name TEXT, `is_active` BOOL, timestamps |
| `payment_method` | id UUID, code TEXT UNIQUE, `label_fr` TEXT, `label_ar` TEXT, `is_active` BOOL, `requires_note` BOOL, timestamps |

Hand-added SQL:

- `CHECK (currency.decimal_places BETWEEN 0 AND 6)`.
- `CHECK (contact.is_customer OR contact.is_supplier)` — a contact must be
  at least one side, but may be both.
- `CHECK (payment_method.code <> '' AND length(payment_method.code) <= 32)`.

Seeds:

- `currency`: MRU (dp=2, base), USD (dp=2), EUR (dp=2). MRU **must** be
  seeded first because the settings migration depends on it existing.
- `payment_method`: `CASH`, `BANKILY`, `MASRIVI`, `SEDAD`, `OTHER`. Only
  `OTHER` has `requires_note = true`. See D-020.

### `20260805_add_settings`

Single-row settings table:

| Table | Columns |
|---|---|
| `settings` | id INT PK `CHECK (id = 1)`, `base_currency_id` UUID FK → currency, `business_timezone` TEXT DEFAULT `'Africa/Nouakchott'`, `negative_balance_override_allowed` BOOL DEFAULT false, `go_live_at` TIMESTAMPTZ NULL, `updated_at`, `updated_by_user_id` UUID |

Seeded on migration with `id=1` and `base_currency_id` pointing at MRU. If
MRU doesn't exist, the migration fails — deliberate.

`go_live_at` NULL means "pre-go-live", which unlocks the opening-balance
edit path in P3-10. Once set, it cannot be cleared without a migration.

---

## 3. Core services

### `CurrenciesService`

- `create` / `update` (metadata only). `code` is immutable once any ledger
  row references it — enforced from P3-01 onward by counting
  `currency_ledger`. In P2 the check is a no-op (no ledger yet) but the
  guard code exists.
- `deactivate` refuses if the currency has an active balance or is
  referenced by any active source row. In P2 both counts are trivially zero;
  P3's DoD reopens this check with real data.
- No `delete`. The controller does not expose one. The application role has
  no `DELETE` grant on `currency` — added as a raw SQL statement in the
  migration.

### `ContactsService`

- Duplicate phone: **warning, not block** (spec §10.3). On POST, if a
  contact with the same phone exists, return `409 { warning:
  "duplicate_phone", existing: {…} }`. A second POST carrying
  `confirmDuplicate: true` proceeds. The frontend renders a confirm dialog
  around this contract; do not encode "confirm" in the URL — it belongs in
  the body.
- Archive-not-delete via `is_archived`.
- A contact who is both customer and supplier is one row, not two. The DoD
  asserts this end-to-end.

### `SettingsService`

- One-row semantics: `GET /settings` returns the row; `PATCH /settings`
  updates it. No create, no delete.
- `POST /settings/go-live` writes `go_live_at = now()`. Owner-only, separate
  permission. Confirmation dialog on the frontend.
- `common/period.ts` shifts to reading `business_timezone` from settings.
  The env var (`BUSINESS_TZ`) remains a fallback used by tests that boot
  without the settings row.

### `AuditService` (extended)

Wired to: currency create/update/deactivate, contact create/update/archive,
user create/deactivate/reset-pin, role assignment, settings update.
`before`/`after` carry the *changed subset* — not the whole row. Overfull
audit rows destroy their own readability.

---

## 4. Endpoints

| Method | Path | Permission |
|---|---|---|
| GET/POST/PATCH | `/api/v1/currencies` | `currency:read` / `currency:manage` |
| POST | `/api/v1/currencies/:id/deactivate` | `currency:manage` |
| POST | `/api/v1/currencies/:id/reactivate` | `currency:manage` |
| GET/POST/PATCH | `/api/v1/contacts` | `contact:read` / `contact:manage` |
| POST | `/api/v1/contacts/:id/archive` | `contact:manage` |
| GET/POST/PATCH | `/api/v1/expense-categories` | `expense_category:manage` |
| GET/POST/PATCH | `/api/v1/payment-methods` | `payment_method:manage` |
| POST | `/api/v1/payment-methods/:id/deactivate` | `payment_method:manage` |
| GET/PATCH | `/api/v1/settings` | `settings:manage` |
| POST | `/api/v1/settings/go-live` | `settings:go_live` |
| GET/POST | `/api/v1/users` | `user:read` / `user:create` |
| POST | `/api/v1/users/:id/deactivate` | `user:manage` |
| PATCH | `/api/v1/users/:id/roles` | `user:manage` |

The route-table test from P1-07 continues to guard: any new controller
method without `@RequirePermission` or `@Public` fails CI.

---

## 5. Frontend

Routes:

```
/currencies                        CurrenciesListPage
/currencies/:id/edit               CurrencyFormPage
/contacts                          ContactsListPage
/contacts/:id                      ContactProfilePage
    tabs: overview, receivables*, payables*, trades*
    (* explicit "arrives in Phase 4/5" placeholder card)
/users                             UsersListPage
/users/:id                         UserFormPage
/settings                          SettingsPage
    nested: profile, business (timezone, base currency, go-live),
            payment-methods, expense-categories, permission-matrix
```

The Phase 4/5 placeholders are literal cards ("Available from Phase 4
(trades)") — not empty tables. An empty table reads as bug, not as scope.

Notable components:

- `CurrencyForm` — inline explanation of `decimal_places` ("USD uses 2 →
  cents; JPY uses 0 → whole yen").
- `DuplicatePhoneWarningDialog` — the "create anyway" UX for P2-09.
- `PermissionMatrix` — role × permission grid with checkboxes, owner-only.
  The matrix reads from `common/permissions.ts` at build time, so a new
  permission appears here automatically.
- `PaymentMethodsSettings` — list, add, deactivate. `requires_note` on
  `OTHER` is rendered read-only with a tooltip ("OTHER always requires a
  note"). Deactivating `CASH` is refused server-side.

Cache keys added: `['currencies']`, `['contacts', { filters }]`,
`['contact', id]`, `['settings']`, `['payment-methods']`,
`['expense-categories']`, `['users']`.

i18n: every new key lands in `ar.json` and `fr.json` in the same commit.
The parity test from P1-13 catches drift.

---

## 6. Tests

Integration, real Postgres, no mocks:

1. **P2-01** Deactivating an unreferenced currency succeeds; reactivating
   succeeds. `DELETE /api/v1/currencies/:id` returns 404/405 — screenshot
   into the PR. (The "in-use" rejection has real bite from P3 onward.)
2. **P2-03** POSTing a contact with a phone that already exists returns 409
   with `warning: "duplicate_phone"`. POSTing again with `confirmDuplicate:
   true` creates a distinct contact; both list.
3. **P2-03** Flipping a customer to also-a-supplier preserves the same
   contact ID and its notes.
4. **P2-05** Deactivating a payment method preserves history but removes it
   from the picker; the ID still resolves for rendering old ledger entries
   (proven with a fixture insert). Trying to DELETE returns 405 or 404.
5. **P2-05** Creating a payment method with `code = 'OTHER'` fails —
   duplicate. Creating one with `requires_note = true` succeeds; posting a
   ledger entry against it with an empty note is rejected in P3.
6. **P2-06** Owner resets another user's PIN; employee attempt gets 403;
   both attempts land in `audit_log`.
7. **P2-02** Changing `business_timezone` from Africa/Nouakchott to
   Europe/Paris shifts `startOfPeriod('month', d)` by one hour on a
   fixture date at 23:30 UTC.
8. **P2-11** UI: opening the ContactProfile Phase-4/5 tabs shows the
   placeholder card, not an empty table (component test).

---

## 7. Definition of Done — checklist

- [ ] Every P2-01 → P2-12 task has an integration test.
- [ ] `DELETE /api/v1/currencies/:id` and `DELETE /api/v1/payment-methods/:id`
      return 404/405; curl output in the PR.
- [ ] Two contacts with the same phone can both be created — reproduced
      with two curl POSTs, output in the PR.
- [ ] `common/period.ts` reads timezone from `settings`, not from an env
      var. The env-var fallback remains and is used by tests only.
- [ ] The five seeded payment methods are visible via HTTP; only `OTHER`
      has `requires_note = true`.
- [ ] `docs/schema-review.md` (P2-13) exists, is signed off by at least
      one second reviewer, and every question it raises is either an
      accepted `D-0xx` decision or an explicit Pending entry with a named
      owner.
- [ ] `ls api/prisma/migrations/` shows no migration creating
      `currency_ledger`, `currency_balance`, `cost_movement`,
      `currency_cost`, `purchase`, `sale`, `receivable`, `payable`,
      `payment`, `allocation`, `expense`, or `rate_snapshot`.

---

## 8. P2-13 — the schema review, in more detail

Not a code task. Produces one document, `docs/schema-review.md`, containing:

1. **Every remaining table through Phase 8**, laid out with columns,
   types, nullability, indexes, and foreign keys: `currency_ledger`,
   `currency_balance`, `cost_movement`, `currency_cost`, `purchase`,
   `sale`, `receivable`, `payable`, `payment`, `allocation`, `expense`,
   `opening_balance`, `rate_snapshot`.
2. **Raw-SQL constraints Prisma cannot express**, per table, with the SQL
   body. These are the constraints P3-01 will paste into the first
   financial migration. Examples:
   - `CHECK (currency_balance.cached_amount >= 0)` on non-base currencies
     (partial constraint with FK to `currency` where `is_base = false`,
     or an application-role enforcement — decide in the review).
   - `GRANT NO DELETE` on every financial table for the app role.
   - `CHECK (receivable.outstanding_amount >= 0)`,
     `CHECK (payable.outstanding_amount >= 0)`,
     `CHECK (allocation.amount > 0)`.
   - Indexes covering the spec §24 filter set.
3. **Deviations from the spec**, each cross-referencing its `D-0xx`
   entry or requiring a new one. Non-exhaustive: D-013 (status split),
   D-020 (payment method on ledger), D-010 (nullable source + origin
   discriminator on receivable/payable).
4. **Open questions** to close before P3-01 lands. D-016 is one — it
   stays Pending but is tagged so it is not lost.
5. **A sign-off checklist** at the bottom with named checkboxes:
   `reviewed by <name>`, `reviewed by <name>`, `walked with client
   YYYY-MM-DD`, `raw-SQL constraint list matches P3-01 checklist`.

Rejected shortcut: auto-generating from `schema.prisma`. This is a **paper
review**. The paper form is exactly what makes it catch things — reading
Prisma models on a screen next to `docs/spec.md` never does.

---

## 9. Explicitly deferred

- **Any financial write, migration, or table.** Ledger, balances, cost,
  trades, debts, expenses — all Phase 3+.
- **`rate_snapshot`** — designed in P2-13; migration lands with P8-01.
- **The `origin` field on receivables/payables** (D-010) — designed in
  P2-13; migration lands with P3-09 / P4-01.
- **Multi-currency contact profile figures** — the placeholder tabs stay
  placeholders until P5-11.
- **Historical import from an old system** — opening balances in P3-08 are
  the only supported entry path.
- **Any user-visible profit or debt number** — reports and dashboards are
  P7. The temptation in P2 will be to "add a small preview". Don't.
- **Bulk operations** — bulk deactivate currencies, bulk archive contacts.
  No user has asked for it; adding it uninvited multiplies audit-log
  entries in ways that surprise later.
