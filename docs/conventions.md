# Conventions

Tooling enforces what it can (ESLint, Prettier, TypeScript strict, Prisma
validate). This covers what it can't.

---

## 1. Git

Trunk-based. `main` is always deployable. Task branches are short-lived and
named for their task ID:

```
feat/P4-03-sale-service
fix/P5-11-allocation-rounding
```

Squash-merge into `main`. One task per branch where possible; a phase's PR split
(architecture §3.3, and the phase docs) overrides this for dangerous phases.

Commits are conventional commits carrying the task ID:

```
feat(P4-03): sale service with cost disposal
test(P4-09): concurrent sale of the same currency balance
fix(P5-11): round allocation to payment currency decimals
```

**Self-review before opening a PR** — walk your own diff and tick these:

- [ ] Every write to `currency_ledger` / `currency_balance` / `cost_movement` /
      `currency_cost` goes through `LedgerService`.
- [ ] Every Prisma call inside a business operation uses the `tx` client.
- [ ] No `number` holds a monetary value anywhere in the diff.
- [ ] Every new route has an explicit `@RequirePermission`.
- [ ] Every new user-facing string exists in **both** AR and FR.
- [ ] Hand-written SQL in the migration survived the last regeneration.

---

## 2. TypeScript

`strict: true`, no `any` outside typed third-party shims, no non-null assertions
in business code. Money is `Prisma.Decimal` in the API and `string` on the wire
and in the browser. `noUncheckedIndexedAccess` on.

Domain enums are TypeScript union types backed by Prisma enums — never bare
strings.

---

## 3. Backend conventions

Scaffold with the Nest CLI rather than by hand:

```bash
cd api
npx nest g module trades
npx nest g controller trades --no-spec
npx nest g service trades --no-spec
npx prisma migrate dev --name add_sale_table
npx prisma generate
```

Module layout:

```
src/trades/
├─ trades.module.ts
├─ purchases.controller.ts     thin: validate → guard → one service call
├─ purchases.service.ts        owns $transaction, throws domain errors
├─ dto/create-purchase.dto.ts  class-validator, money as string
└─ trades.types.ts
```

Rules:

1. **Controllers are thin.** DTO in, one service call, domain error mapping out.
   If a controller has an `if` about business rules, it's in the wrong file.
2. **Services own transactions.** `prisma.$transaction(async (tx) => …)` opens
   at the top of the method and every read that must be consistent uses `tx`.
3. **Cross-module access** goes through the other module's exported service, and
   only downward: feature modules may use `ledger`, never the reverse.
4. **Money arithmetic** uses `Prisma.Decimal` or the helpers in
   `common/money.ts`. Rounding always goes through `roundTo(amount, currency)`,
   which reads the currency's `decimal_places` (D-009).
5. **Dates**: `timestamptz` in UTC. Period boundaries only via
   `common/period.ts`, which applies the configured business timezone (D-012).
6. **Domain errors**, never `throw new Error`. Each carries structured data for
   the message ("400.00 available") and maps to one i18n key.
7. **Migrations** are additive where possible, reviewed by hand for the raw-SQL
   constraints, and never edited after merge.

---

## 4. Frontend conventions

```
web/src/features/sales/
├─ routes/SalesListPage.tsx
├─ components/SaleForm.tsx
├─ api/useSales.ts          query + mutation hooks, cache keys live here
└─ sales.i18n.ts            or keys under locales/{ar,fr}/sales.json
```

- Cache keys are declared once per feature in `api/`, never inlined at call
  sites. Mutations list the exact keys they invalidate.
- All layout uses logical properties. Nothing assumes LTR. Test RTL by
  switching the language, not by reading the CSS.
- Every money value on screen renders through `formatMoney` and shows its
  currency code (spec §36).
- Tables are paginated server-side. The browser never receives a full
  transaction history (spec §41).
- New strings land in `ar` and `fr` in the same commit. A key present in one
  language only fails review.

---

## 5. Testing

**Must have integration tests** (real Postgres, real transactions, no mocks):
every operation that writes to the ledger, every reversal path, every
permission boundary.

**Standing invariants** run in the suite's global `afterEach`, so every test in
the suite verifies them for free. They are also shipped as
`api/scripts/check-invariants.ts`, runnable against production on a cron.

| ID | Property |
|---|---|
| INV-1 | For every currency: sum of active ledger credits − debits = `currency_balance.cached_amount` |
| INV-2 | For every receivable: `original − Σ active allocations = outstanding_amount`, and `outstanding_amount >= 0` |
| INV-3 | Same for every payable |
| INV-4 | For every currency: `currency_cost.cached_avg` equals a replay of its active cost movements |
| INV-5 | No allocation makes its target's paid amount exceed its original amount |
| INV-6 | Every ledger entry has an active source, and every active financial source has its ledger entries |
| INV-7 | Every purchase and sale has exactly one base-currency leg |
| INV-8 | No non-base currency has a negative balance |
| INV-9 | Every cash-movement ledger entry has a payment method, and every entry on a method flagged `requires_note` has a non-empty note |

That the invariants still hold **after a reversal test** is half their value —
reversal bugs are almost always "state restored *almost* correctly."

**Financial regression suite**: the spec's §44 acceptance scenario is a fixed
fixture with known expected values, run on every CI build. It is not allowed to
be updated to match new behaviour — if it fails, the behaviour is wrong.

Test naming: `describe('SaleService.create')` → `it('rejects when the delivered
currency balance is insufficient')`. Say what fails, not what is called.

---

## 6. Definition of Done (any task)

1. Code merged to `main` behind a green CI run, including all invariants.
2. Integration test exists for every new path that writes to the ledger.
3. Every new route has a permission decorator and a test proving the API — not
   the UI — rejects the unauthorized role.
4. Both AR and FR strings present; the screen has been looked at in RTL.
5. Any decision made along the way is recorded in `decisions.md`.
6. The task's checkbox in `tasks.md` is ticked, in the same PR.

---

## 7. Domain glossary

Code is English; the UI is Arabic and French. One canonical term per concept —
add new concepts here **before** using them in code. Renaming i18n keys later is
miserable.

| Concept | Code | FR | AR |
|---|---|---|---|
| Currency bought from a counterparty | `purchase` | achat | شراء |
| Currency sold to a counterparty | `sale` | vente | بيع |
| A person, either side | `contact` | contact | جهة |
| Money owed **to** us | `receivable` | créance | مستحقات |
| Money owed **by** us | `payable` | dette fournisseur | التزامات |
| A cash movement settling a debt | `payment` | règlement | تسديد |
| A payment applied to one debt | `allocation` | affectation | تخصيص |
| Agreed rate on a deal | `rate` | taux convenu | السعر المتفق |
| MRU value of one unit of the payment currency | `payment_base_rate` | taux de base | سعر الأساس |
| Informational market rate | `market_rate` | taux du marché | سعر السوق |
| Reporting currency (MRU) | `base_currency` | devise de référence | العملة المرجعية |
| Weighted-average unit cost | `average_cost` | coût moyen | التكلفة المتوسطة |
| Ledger row | `ledger_entry` | écriture | قيد |
| Undoing a confirmed transaction | `reversal` | contre-passation | عكس القيد |
| Starting position before go-live | `opening_balance` | solde d'ouverture | الرصيد الافتتاحي |
| How the cash physically moved | `payment_method` | moyen de paiement | وسيلة الدفع |

Avoid: "transaction" as a domain noun (it means the database kind here — use
*trade*, *payment*, or *expense*), "debt" without a side (say receivable or
payable), "cost" without a currency.

---

## 8. Things we never do

1. Never write to a balance, ledger, or cost table outside `LedgerService`.
2. Never hold money in a JavaScript `number`.
3. Never delete a financial record — reverse it.
4. Never change a stored rate after confirmation, for any reason.
5. Never net a contact's receivables against their payables.
6. Never add an amount in one currency to an amount in another.
7. Never accept a trade without a base-currency leg — reject it, never infer a rate.
8. Never trust the frontend for a permission check.
9. Never call `LedgerService.apply` in a loop within one operation.
