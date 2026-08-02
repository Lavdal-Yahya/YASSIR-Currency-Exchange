# Decisions Log

One entry per settled decision. Purpose: stop us relitigating closed
questions, and give the *why*, not just the *what*. Newest at the bottom.
Never delete an entry — supersede it with a new one referencing the old.

Format: ID · date · status (Accepted / Pending / Superseded by D-xxx).

---

## D-001 · 2026-07-28 · Accepted
**Stack is NestJS + React + PostgreSQL, deployed as a mobile-first PWA on our own VPS.**

Carried over from the warehouse system, which is in production with the same
shape of problem (money, debt, multi-user concurrency). Familiarity outranks
novelty on a project where correctness matters more than speed: we already know
the failure modes, the deployment path, and the testing harness style. Rejected:
a serverless/BaaS backend (transaction control is non-negotiable here, §32 of the
spec) and a native app (explicitly out of scope, spec §47).

---

## D-002 · 2026-07-28 · Accepted
**Money is stored as PostgreSQL `NUMERIC`; JavaScript `number` is banned for any monetary value.**

`NUMERIC(24,4)` for amounts, `NUMERIC(24,8)` for rates, per spec §7.3. All
arithmetic happens through the ORM's decimal type or `decimal.js` — never through
IEEE-754 floats.

Note this does **not** carry over from the warehouse system, where whole-MRU
integers were sufficient. Currency trading has sub-unit amounts (USD cents) and
8-decimal rates, so the integer trick doesn't apply. Rejected: storing minor units
as `BigInt`, because currencies here have differing `decimal_places` and a single
integer scale would need per-currency shifting at every boundary.

---

## D-003 · 2026-07-28 · Accepted
**Currency balances are derived from an append-only ledger; the balance column is a cache, not the truth.**

Spec §8.3 and §30.4 both demand this. A stored, editable balance drifts silently
and cannot be audited. `currency_balance.cached_amount` exists only so the
dashboard doesn't sum a million rows, and a standing invariant test (INV-1)
asserts on every test run that it equals the ledger sum. When they disagree, the
ledger wins.

---

## D-004 · 2026-07-28 · Accepted
**Every currency movement goes through exactly one code path: `LedgerService.apply(tx, movements[])`.**

The transaction client is a **required** first parameter, so "change a balance
outside a transaction" is not expressible in the type system rather than merely
forbidden. It locks affected `currency_balance` rows in ascending `currency_id`
order — a purchase touches two currencies, and two concurrent trades locking them
in opposite orders will deadlock in production on the busiest day.

It is a **batch** API only. Calling it in a loop within one business operation is
a bug, because that reintroduces the ordering problem it exists to prevent.

Rejected: database triggers maintaining balances. They're invisible at the call
site, hard to test, and impossible to give useful error messages from
("insufficient USD: 400 available, 1,000 requested" beats a constraint violation).

---

## D-005 · 2026-07-28 · Accepted
**Every trade is modelled symmetrically: the currency received is *acquired* at its MRU value, the currency delivered is *disposed* at its weighted-average cost. Realized gain/loss arises on any non-base disposal.**

> **Amended 2026-07-29.** This entry was originally justified by the client
> trading cross-pairs. That premise was corrected (see D-019 — MRU is on every
> trade). The decision **stands**, on the narrower but still sufficient grounds
> in point 2 below, which does not depend on cross-pairs.

This is a deliberate generalization of spec §19.3. The spec's model recognizes
profit only on "sales" and only creates cost basis on "purchases", which leaves
two holes:

1. ~~A cross-pair sale has no MRU leg, so its revenue is uncomputable as
   written.~~ (Moot under D-019.)
2. The payment currency *received* on a sale gains stock with no cost basis, so
   the next sale of that currency prices it at zero. This still bites with MRU on
   every leg: an operator who records a customer buying USD as a *sale of MRU*
   rather than a *purchase of USD* produces, under the spec's model, a USD
   position with no cost. The symmetric model is indifferent to which label the
   operator picks — and operators will pick the wrong one.

Under the symmetric model, purchase/sale is a counterparty label, not an economic
distinction — every trade acquires one currency and disposes another.

**It reduces exactly to the spec's model when MRU is on one leg.** Verified
against spec §44: purchase of 10,000 USD for 390,000 MRU acquires USD at 39.00 and
disposes MRU at cost 1.00 (no gain); the sale of 4,000 USD for 164,000 MRU
disposes USD at 39.00 (cost 156,000) and acquires MRU at 164,000 → gross profit
8,000 MRU. Identical to the spec's expected figures.

---

## D-006 · 2026-07-28 · Accepted
**The base currency (MRU) has a fixed unit cost of 1.00 and never generates realized gain or loss.**

MRU is the measurement unit, not a tradable position. This falls out of D-005 and
is what makes the general model collapse into the spec's simple one for the
common case.

---

## D-007 · 2026-07-28 · Superseded by D-019
**Every transaction whose payment currency is not the base currency stores a `payment_base_rate` (MRU per 1 unit of payment currency), snapshotted at confirmation and never updated.**

This is the field that makes cross-pair profit computable (C1 from the spec
review). It is `1.00000000` when the payment currency is MRU, non-null and > 0
always. The UI pre-fills it from the most recent *business* rate for that currency
against MRU, falling back to the cached market snapshot, and it is always
editable — but once the transaction is confirmed, it is frozen. Spec §20 forbids
re-valuing history at today's rate.

Rejected: deriving it at report time from a rate table. That makes historical
reports change retroactively, which is exactly what §20 prohibits.

---

## D-008 · 2026-07-28 · Accepted
**The cost engine orders movements by ledger sequence (insertion order), never by `transaction_date`.**

Backdating is permitted (spec §9.2, §11.1) but must not retroactively rewrite the
profit on sales that have already been reported. `transaction_date` drives
reporting periods only. A purchase entered today with last month's date affects
the average cost from today forward.

Cost of this: entering a batch of historical transactions out of order produces
averages that differ from what a strict chronological replay would give. Accepted
— the alternative silently mutates closed periods.

---

## D-009 · 2026-07-28 · Accepted
**Totals are rounded to the payment currency's `decimal_places`, half-up, at write time. The rounded value is the truth.**

`amount × rate` yields more decimals than any currency has. Without a fixed rule,
`outstanding = total − paid` drifts by fractions and the "payment cannot exceed
outstanding" check (spec §30.3) starts rejecting legitimate final payments. The
rate is stored at full 8-decimal precision; the total is stored rounded; the two
are allowed to disagree by less than one minor unit and a check constraint
enforces that bound.

When the user types the total directly (spec §11.2), the server derives the rate
as `total / amount` at full precision instead.

---

## D-010 · 2026-07-28 · Accepted
**Receivables and payables carry a nullable source with an `origin` discriminator (`TRADE` | `OPENING`).**

Spec §9.2 creates opening debts that have no originating sale, but §28.7 makes
`sale_id` required. Rather than fabricating synthetic sales, the source is
nullable and `origin` says why. Reports filter on `origin` where the distinction
matters (spec §23.6 asks whether opening entries are included).

---

## D-011 · 2026-07-28 · Accepted
**Payments are recorded as one payment row with N allocation rows against receivables/payables, defaulting to oldest-first. The v1 UI targets a single debt.**

Spec §15.1 links a payment to one receivable, which is fine until a customer hands
over a lump sum against three old debts — and they will. The allocation table
costs nothing to build now and is a painful migration later. We build the schema
and the service for N allocations, and ship a single-target form in v1 so the
scope stays where the spec put it.

Allocation liveness is **derived**, not stored: an allocation counts if and only
if its payment and its target are both active. A reversal flips one status flag
instead of synchronizing three tables.

---

## D-012 · 2026-07-28 · Accepted
**Timestamps are stored as `timestamptz` in UTC; report period boundaries are computed in a configured business timezone (Africa/Nouakchott).**

Spec §36 warns against trusting the device timezone for report boundaries. The
timezone is a settings row, not a hardcoded constant, and every report boundary
calculation goes through one shared helper.

---

## D-013 · 2026-07-28 · Accepted
**Transaction lifecycle status and payment status are two independent enums.**

Spec §25 lists `CONFIRMED`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`, `REVERSED` as
one set, but a transaction can be simultaneously `CONFIRMED` and `PARTIALLY_PAID`,
and `CANCELLED` says nothing about payment. Split into `status`
(`CONFIRMED` | `CANCELLED` | `REVERSED`) and `payment_status`
(`UNPAID` | `PARTIALLY_PAID` | `PAID`). `DRAFT` is dropped — spec §25 itself
recommends omitting it.

---

## D-014 · 2026-07-28 · Accepted
**Balance sufficiency is validated against the cash actually moving, not the transaction's total value.**

Spec §11.5 reads as though an unpaid purchase requires the full payment-currency
balance. It doesn't — an unpaid purchase moves no cash. The check applies to
`immediate_payment` on trades, to the payment amount on settlements, and to the
amount on expenses.

---

## D-015 · 2026-07-28 · Accepted
**Negative balances are blocked by default; the override is owner-only, requires a written reason, is audit-logged, and is refused entirely for non-base currencies.**

Spec §8.4 makes the override configurable. But a negative quantity has no
meaningful weighted-average cost, so allowing it on a traded currency corrupts the
cost engine (C7). MRU has a fixed unit cost of 1 (D-006) and is therefore safe to
overdraw. A `CHECK (cached_amount >= 0)` constraint holds for every non-base
currency as an independent last line of defense.

---

## D-016 · 2026-07-28 · Superseded by D-021
**Reversing a purchase whose currency has since been sold: recompute-and-restate, or block-and-adjust?**

Later sales priced their cost using the average that the reversed purchase
created. Two coherent options:

- **Recompute and restate** — mark the cost movement inactive, replay forward,
  and let previously reported gross profit change. Idempotent and self-correcting,
  but a report the owner printed last week will no longer match.
- **Block and adjust** — refuse reversal once later movements exist on that
  currency; require a compensating adjustment transaction dated today instead.
  History is immutable, but the books carry a correction rather than a fix.

**Resolved 2026-08-01 by D-021: recompute-and-restate.** See D-021 for reasoning.

---

## D-017 · 2026-07-28 · Accepted
**Settling a payable denominated in a non-base currency realizes an FX gain or loss at settlement.**

Falls out of D-005: paying a 5,000 EUR supplier debt disposes 5,000 EUR at the
current weighted-average EUR cost, which may differ from the EUR value implied
when the payable was created. The difference is real economic profit and is
reported as such, separately from trading gross profit. Not a bug; document it in
the profit report so it doesn't look like one.

---

## D-018 · 2026-07-28 · Accepted
**Profit visibility is enforced in the API serializer, not the UI.**

Spec §5.2 makes profit visibility a separate permission because the owner may not
want employees to see it. `gross_profit` and `cost_of_currency_sold` live on the
sale row and are stripped server-side for users without `profit:view`. An
integration test asserts the fields are absent from the HTTP response, not merely
hidden by the frontend.

---

## D-019 · 2026-07-29 · Accepted
**Every trade has the base currency (MRU) on exactly one leg. This is enforced as a validation rule and a database constraint, and it removes the `payment_base_rate` field entirely (superseding D-007).**

Corrects the kickoff answer that the client trades cross-pairs. They do not —
MRU is one side of every exchange.

The consequence is a simplification. When one leg is MRU, the MRU value of the
trade is **directly observable** as that leg's amount; there is nothing to
convert and no second rate to capture. `payment_base_rate` (D-007) existed only
to value a trade with no MRU leg, so it goes, along with the UI that would have
had to pre-fill it and the class of errors that come from a plausible-looking
wrong base rate.

We enforce the rule rather than merely assuming it. A trade submitted with no
MRU leg is **rejected** with `NoBaseCurrencyLegError`, not silently accepted:

- It is almost certainly a data-entry mistake, and a rejection surfaces it at the
  moment it happens rather than as an inexplicable profit figure a month later.
- If the client's business genuinely changes, this decision gets superseded and
  the field comes back deliberately — which is what this log is for. A quiet
  assumption baked into the cost engine would not give us that.

Both legs being MRU is also rejected: that is not an exchange.

Cost: the design is now coupled to a business fact that could change. Accepted,
because the coupling is one named constraint in one place rather than a
pervasive assumption.

---

## D-020 · 2026-07-29 · Accepted
**Cash movements record *how* the money moved, via a seeded `payment_method` lookup table rather than a hardcoded enum.**

Client change request (spec §48), raised 2026-07-29: money in should carry a
payment method — cash, Bankily, Masrivi, Sedad, or other with free text.

Three design points:

**A lookup table, not a Prisma enum.** Mauritanian mobile-money providers change;
a new one should be a row the owner adds in Settings, not a migration and a
deploy. Seeded with `CASH`, `BANKILY`, `MASRIVI`, `SEDAD`, `OTHER`, each with
`is_active` and `requires_note`. Only `OTHER` sets `requires_note`, and the
server rejects an empty note when it is set.

**It lives on the ledger entry, not on the transaction.** The ledger is already
the single source of truth for cash movement, and the cash-in/cash-out reports
already read from it — so grouping cash by method costs one `GROUP BY` and no
joins. Storing it on `sale`, `purchase`, `payment`, and `expense` instead would
mean a four-way union to answer "how much came in through Bankily this month",
which is the entire point of the field. `paymentMethodId` therefore becomes an
optional field on `LedgerService`'s `Movement` type.

**It applies to money out as well as money in.** The client asked only about
inflows, and adding outflows is a deliberate extension of their request. The
reason: the field's real value is reconciling against a Bankily or Masrivi
statement, and a statement has both columns. Recording only inflows gives half a
reconciliation, and the schema cost of the other half is zero today and a
migration later. Flagged to the client as part of the change request.

**Not in scope:** splitting one payment across two methods (part cash, part
Bankily). One method per cash movement in v1. If the client needs splits, it is a
separate change request and a genuine modelling change, not a field.

The traded-currency legs of a trade — the USD physically received in a purchase —
carry a null method in v1. The column exists on those rows if the client later
wants to distinguish physical notes from an inbound wire.

---

## D-021 · 2026-08-01 · Accepted
**Trade reversal recomputes and restates (resolves D-016).**

Reversing a purchase or sale marks the source's cost movements inactive, calls
`CostEngine.replay(currencyId)` forward from that point, and rewrites
`cost_of_currency_sold_mru` and `gross_profit_mru` on every affected downstream
sale in the same transaction. Payables/receivables are recomputed via
`RecomputeService.recompute` (their allocations lose liveness because the target
is inactive — D-011).

The consequence, stated plainly for the profit report: **a report the owner
printed last week can show a different gross profit next week if a trade in that
period is reversed today.** The `TradeReversalService` response includes the
count of restated sales so the operator sees this at the moment it happens
("Cette contre-passation a recalculé N ventes"), and the audit log carries
before/after on every restated row so the diff is inspectable in the audit
viewer (P6-06).

Rejected — *block and adjust* (the other D-016 shape). Refusing reversal once
later cost movements exist would force the operator either to invent a
compensating trade dated today — which either violates D-019 (no MRU leg on a
correction against an existing non-base position) or requires a new
"adjustment" record type outside the trade model — or to leave the wrong
figures standing and add a manual note. Either path is more surface area than
the replay, which reuses code that already exists: `CostEngine.replay` was
written for exactly this purpose in P3.

The idempotency of `replay` is what makes this safe. The cost cache after N
reversals equals the cache computed from scratch, regardless of the order in
which reversals were applied. Delta-patching from `apply()` cannot match that —
it accumulates drift, and INV-4 catches the drift a week later without
pointing at which reversal caused it.

**Cost accepted:** historical reports are not immutable. Mitigations:
1. Reversal is owner-only (`reversal:trade`), separately audited (P6-05).
2. The reversal dialog (S-31) names the restatement consequence in plain terms
   *before* the operator confirms — the surprise is at input, not at the next
   report.
3. Every reversal carries a mandatory reason; the audit log is the seal on
   history even though the numbers move.

Not in scope: warning when a reversal crosses a "closed period." No period is
closed in this system — the audit log is the closure. If period closing is
ever added, it becomes a new decision.

---

## D-022 · 2026-08-02 · Accepted
**`react-router-dom` is pinned at `^7.18.2` despite an outstanding advisory in the `7.12.0 - 8.2.0` range, because that advisory is inapplicable to our deployment shape.**

Two npm advisory ranges cover `react-router-dom` and have no clean overlap:

- **`6.0.0 - 7.17.0`** — XSS via open redirects in `Link` / `useNavigate`,
  unescaped `Location` header on prerendered redirects, protocol-relative
  redirect confusion, and several SSR/RSC-only issues. Fixed in **≥7.18.2**.
- **`7.12.0 - 8.2.0`** — RSC-mode CSRF bypass allowing action execution before
  a 400 response. Fixed by <7.12 or ≥8.3.

Every version currently published sits in at least one range. Pinning below
7.12 (as an earlier attempt tried) still triggers the first bundle's
client-side XSS/open-redirect CVEs, which *do* affect a plain SPA — those are
the ones a currency-exchange operator can hit by pasting a crafted URL.

The second advisory requires React Router **framework mode** (Remix or the
React Router server) with server components and server actions. Our web
workspace is a Vite SPA calling the NestJS REST API with a `SameSite=Lax`
cookie — there is no `action` export, no server component, no framework-mode
runtime. The exploit has no surface here.

Reassess this decision if the frontend adopts SSR, RSC, or React Router
framework mode — the deployment premise would then no longer hold. Reassess
also when the advisory ranges are reconciled upstream so a single version
clears both; at that point the pin becomes plain hygiene rather than a
recorded acceptance.

Rejected: `overrides` block or `npm audit fix --force`. Both shift the problem
without documenting it, and both re-trip `npm audit` on the next lockfile
regeneration.
