# Screens & Pages

Every screen in the app, what it is for, and which phase builds it. Read
alongside `tasks.md` (what gets built when) and `design-prompt.md` (how it
should look).

Screen IDs (`S-xx`) are stable and get referenced from tasks and PRs.

---

## 1. Navigation model

Spec §3.1 requires the primary actions to stay visible, and §3.2 makes the phone
the primary device. That produces a two-part structure:

**Bottom tab bar — five slots, never more** (a sixth turns the bar into a menu):

```
┌──────────────────────────────────────────────┐
│                                              │
│                 screen body                  │
│                                              │
│                    ╭───╮                     │
│                    │ + │  ← action sheet     │
├────────┬───────┬───┴───┴───┬────────┬────────┤
│  Home  │ Trades│    +      │ Debts  │  More  │
└────────┴───────┴───────────┴────────┴────────┘
```

**The `+` opens an action sheet with the five daily actions**, in this order —
Buy currency · Sell currency · Receive payment · Pay supplier · Add expense.
This is the single most-used control in the product. It is thumb-reachable, it
never moves, and the sheet items are filtered by permission (an employee without
`expense:create` sees four, not a greyed-out five).

`More` holds Contacts, Expenses, Currencies & rates, Reports, and Admin.

**Deliberate deviation from spec §45:** the spec lists separate purchase and sale
list pages. On a phone that means two near-identical screens and a navigation
choice the user shouldn't have to make. We ship **one Trades list with a
segmented filter** (All / Bought / Sold). Same for payment history. Recorded here
so nobody "fixes" it later.

**Deliberate deviation, second:** the spec lists ten reports as ten pages. We
ship **one report screen with ten configurations** — same filter bar, same table
shell, same export button, different columns and data source. Ten hand-built
report pages would drift apart within a month.

---

## 2. Inventory

| ID | Screen | Phase | Permission |
|---|---|---|---|
| S-01 | Login | 1 | public |
| S-02 | Set / change PIN | 1 | authenticated |
| S-03 | App shell + action sheet | 1 | authenticated |
| S-04 | Dashboard | 1 shell, 7 content | `balance:view` |
| S-05 | Buy currency (purchase) | 4 | `purchase:create` |
| S-06 | Sell currency (sale) | 4 | `sale:create` |
| S-07 | Trade confirmation & receipt | 4 | as above |
| S-08 | Trades list | 4 | `purchase:view` / `sale:view` |
| S-09 | Trade detail | 4 | as above |
| S-10 | Debts overview | 5 | `debt:view` |
| S-11 | Receivable detail | 5 | `debt:view` |
| S-12 | Payable detail | 5 | `debt:view` |
| S-13 | Receive customer payment | 5 | `payment:create` |
| S-14 | Pay supplier | 5 | `payment:create` |
| S-15 | Payments history | 5 | `payment:view` |
| S-16 | Contacts list | 2 | `contact:view` |
| S-17 | Contact form | 2 | `contact:manage` |
| S-18 | Contact profile | 2 shell, 4–5 content | `contact:view` |
| S-19 | Expenses list | 5 | `expense:view` |
| S-20 | Add expense | 5 | `expense:create` |
| S-21 | Currency balances | 3 | `balance:view` |
| S-22 | Currency ledger | 3 | `balance:view` |
| S-23 | Currencies admin | 2 | `currency:manage` |
| S-24 | Rate reference | 8 | `currency:view` |
| S-25 | Reports hub | 7 | `report:view` |
| S-26 | Report viewer (×10) | 7 | `report:view` (+ `profit:view`) |
| S-27 | Users & roles | 1–2 | `user:manage` |
| S-28 | Settings | 2 | `settings:manage` |
| S-29 | Audit log | 6 | `audit:view` |
| S-30 | Opening balances wizard | 3 | `opening:manage` |
| S-31 | Reversal dialog | 6 | `transaction:reverse` |

---

## 3. Screen detail

### S-01 Login
Phone number and numeric PIN. **The language switcher must be on this screen** —
a user who cannot read the interface cannot log in to change it. Numeric keypad
for the PIN, not the OS keyboard. States: idle, invalid credentials, account
locked (with the unlock time), account deactivated, offline.

### S-02 Set / change PIN
Forced after an admin reset and on first login. Two entries, no email flow.

### S-03 App shell
Header: screen title, language toggle, user menu. Body. Bottom tab bar and the
`+` action sheet. Persistent `OfflineBanner` that pushes content down rather than
overlaying it, and that **disables every submit button in the tree** while
active — an unsent transaction is never shown as confirmed (spec §34).

### S-04 Dashboard
The owner's answer to all fourteen questions in spec §2. Top: period selector
(Today / Yesterday / Week / Month / Year / Custom) and currency selector. Then,
in order of how often they're looked at:

1. **Balance strip** — one card per currency: available balance, low-balance
   warning, last movement date. Horizontally scrollable on a phone. Under "All
   currencies", each balance stays separate; a base-currency equivalent may
   appear only as an explicitly labelled secondary line.
2. **Cash today** — money in and money out as two figures, never netted.
3. **Debt summary** — receivables and payables totals per currency, top debtors,
   top creditors.
4. **Period summary** — purchases, sales, expenses, gross profit, net profit.
   Profit cards absent entirely without `profit:view` — the grid reflows, it does
   not leave a hole.
5. **Recent activity** — last ~10 movements, each tappable through to detail.

### S-05 / S-06 Buy and Sell currency
The two highest-risk screens in the product. Structure, top to bottom:

```
  Contact                    [ Ahmed Salem        ▾ ]
  ─────────────────────────────────────────────────
  You receive                [ 1 000        ] [USD ▾]
  You pay                    [ 39 000       ] [MRU ▾]
  Rate                        1 USD = 39.0000 MRU
                              ↑ derived, editable, echoed in words
  ─────────────────────────────────────────────────
  Paid now                   [ 20 000       ] MRU
                              ( Full )  ( None )
  Payment method             [ Bankily      ▾ ]
  Reference                  [              ]
  ─────────────────────────────────────────────────
  Owed to supplier            19 000 MRU
  ─────────────────────────────────────────────────
                     [  Review purchase  ]
```

Rules for both screens:

- **Exactly one side is MRU** (D-019). The currency selector on the non-MRU side
  offers every active currency; the other side is fixed to MRU and labelled as
  such. A trade with no MRU leg is not reachable through the UI and is rejected
  by the API if it arrives anyway.
- **Rate, amount, and total are one interlocked group.** Editing any two derives
  the third. Which field is derived is shown, not guessed at.
- **The rate is echoed in words** under the field: "1 USD = 39.0000 MRU". If the
  entered rate is more than ±20% from the last recorded business rate for that
  pair, show an inline warning — not a blocking error. This is the reversed-rate
  guard, and it is the most valuable single element on the screen.
- **"Paid now" defaults to the full amount**, with quick `Full` / `None`
  chips. The outstanding figure updates live and is always visible.
- Payment method is required on the cash leg; the note field appears only for a
  method that demands one.
- Insufficient balance is an inline error on the *paying* field, naming both
  numbers: "Only 15 000 MRU available."

### S-07 Trade confirmation & receipt
A review step before writing, then the same layout as a receipt afterwards. Its
job is to teach the product's central distinction, so it shows **three separate
figures under three separate labels**: total value, paid now, still owed. Never
one number, never two. Post-save: the reference, a Share/print option, and
"Record another".

The save button disables on tap and carries the idempotency key (spec §33).

### S-08 Trades list
Segmented All / Bought / Sold. Rows show date, contact, both amounts, and a
payment-status chip. Filter sheet covering spec §24. Server-paginated, infinite
scroll on phone, page controls on desktop.

### S-09 Trade detail
Everything stored, including the rate as agreed, who entered it, and when.
Linked payments. Linked receivable or payable with its live outstanding amount.
Profit block only with `profit:view`. `Reverse` action only with
`transaction:reverse`, opening S-31.

### S-10 Debts overview
Segmented Owed to us / We owe. Totals per currency at the top — **never a single
grand total**. Then a list grouped by contact, each row showing the outstanding
amount, currency, and age. Ageing filter chips: 0–7 / 8–30 / 31–60 / 60+ days.

### S-11 / S-12 Receivable & payable detail
Original amount, paid, outstanding, status, age, source trade (or an "Opening
balance" marker for `origin = OPENING`). Full settlement history. Primary action
is `Receive payment` / `Pay supplier`, pre-filled with this debt.

### S-13 / S-14 Receive customer payment · Pay supplier
Contact → debt picker showing each open debt with its outstanding amount and age
→ amount → payment method (+ note) → reference → date. The amount field caps at
the outstanding amount and shows the remaining balance live. Paying in a
different currency than the debt is not offered (spec §15.2); the UI states why
rather than silently omitting the option.

### S-15 Payments history
One list, segmented Received / Paid. Filterable by payment method — this is how
the owner reconciles against a Bankily or Masrivi statement.

### S-16 / S-17 Contacts
List with search-as-you-type over name and phone, filter chips for Customer /
Supplier / Both / Archived, and a per-row outstanding-balance summary. The form
warns on a duplicate phone number and lets the user continue anyway (spec §10.3).

### S-18 Contact profile
Tabs: Overview · Trades · Owed to us · We owe · Payments · Notes.

The Overview tab is where the no-netting rule becomes visible: when a contact is
both customer and supplier, the two balances sit **side by side, separately
labelled, with no total between them**, and a one-line note explains that they
are not offset. Someone will ask for a net figure; the screen should answer the
question before it's asked.

### S-19 / S-20 Expenses
List grouped by date with category and payment-method chips. The form is the
simplest in the app — category, amount, currency, method, date, description,
payee — and should feel it.

### S-21 Currency balances
One row per currency: balance, base-currency equivalent (labelled as derived),
low-balance state, last movement. Tapping through goes to S-22.

### S-22 Currency ledger
The audit surface: every movement for one currency, newest first, each row
showing direction, amount, running balance, source type, and a link to the source
transaction. Reversed entries stay visible, struck through and labelled. This is
the screen that makes the ledger real to the owner, and it is the one to reach for
when a balance is disputed.

### S-23 Currencies admin
Code, name, symbol, decimal places, low-balance threshold, active toggle. Decimal
places need a plain-language explanation, since the choice is permanent in
practice. Deactivate, never delete; the delete affordance does not exist.

### S-24 Rate reference
Market rates per pair with the last-updated time and its age, owner buy/sell
rates, and a clear stale-data state. **Informational only** — the screen must say
so, or someone will assume editing it changes their deals.

### S-25 / S-26 Reports
The hub is a list of the ten reports with one-line descriptions. The viewer is
one screen: filter bar (period, currency, contact, status, user, amount range),
a virtualized table, a totals row, and CSV export. Column sets are configuration.
Profit and expense reports require `profit:view` and are absent from the hub
without it.

### S-27 Users & roles
User list with active state and last login. Role editor as a permission matrix
with `profit:view`, `balance:override`, and `transaction:reverse` visually set
apart from the operational permissions — they are the three an owner most often
wants to withhold, and burying them in an alphabetical list hides that choice.

### S-28 Settings
Base currency, business timezone, negative-balance policy, payment methods list,
expense categories, language default, go-live switch. The go-live switch is
one-way and locks opening balances; it needs a confirmation that says so plainly.

### S-29 Audit log
Filterable by actor, entity, action, date. Each row expands to old/new values and
the reason. Owner-only.

### S-30 Opening balances wizard
Three steps — currency balances with opening average cost, customer debts,
supplier debts — then a review screen and go-live. Editable only before go-live.
Used once, so it should be forgiving: import-from-paste would earn its keep here.

### S-31 Reversal dialog
Modal, not a page. Shows what will be undone in plain terms ("This will remove
1 000 USD from your balance and cancel the 19 000 MRU supplier debt"), requires a
typed reason, and names the consequence if the reversal restates reported profit
(pending D-016).

---

## 4. Shared components

| Component | Job |
|---|---|
| `MoneyText` | Every monetary value. Tabular figures, currency code always shown, display rounding only. |
| `DealCard` | The signature component (see `design-prompt.md`). Renders a trade as give / get / rate / cash / owed. Used in the form preview, confirmation, receipt, and list row. |
| `RateField` | The interlocked amount-rate-total group with the plain-language echo and the ±20% sanity warning. |
| `AmountInput` | Numeric keypad, live thousand separators, currency-aware decimals, string-typed to the wire. |
| `CurrencyPicker` | Active currencies only, code-first. |
| `PaymentMethodPicker` | Methods with a conditional note field. |
| `ContactPicker` | Search-as-you-type, shows outstanding balance inline. |
| `ThreeFigureBand` | Value / paid / owed, side by side, never summed. |
| `StatusChip` | Payment status and lifecycle status as visually distinct families. |
| `PeriodPicker` | Preset + custom range, timezone-aware. |
| `BalanceCard` | One currency, with low-balance state. |
| `PermissionGate` | Hides UI. Reflows the layout — no disabled shells, no gaps. |
| `OfflineBanner` | Pushes content, disables submits. |
| `EmptyState` | Per-screen, with the action that fills it. |
| `ErrorInline` | Domain errors near the offending field, with the real numbers. |

---

## 5. The six hard problems

Worth naming for whoever designs this, because each one is a way the product can
be technically correct and still cause a loss.

1. **A reversed rate looks like a valid transaction.** 39 versus 1/39 both save
   cleanly and one is catastrophic. Mitigated by the plain-language echo, the
   ±20% warning, and the review step — three independent chances to notice.
2. **Value, cash, and debt collapse into one number** if the design isn't
   vigilant. Every surface showing a trade shows all three or clearly shows one
   and labels which.
3. **Currencies must never be summed.** Any grand total is either absent or
   labelled as a base-currency equivalent. The temptation is strongest on the
   dashboard.
4. **Two roles, two very different screens.** Without `profit:view` a large part
   of the dashboard and two whole reports disappear. Design both layouts, not one
   with holes.
5. **Digits in Arabic.** Amounts render in Western digits (0–9) in both
   languages; only prose and dates localize. Mixed digit systems in a financial
   app invite transcription errors, and the operator is transcribing from paper
   and from a phone screen at speed.
6. **It's used standing up, one-handed, in bright light.** High contrast, 44px
   minimum targets, no hover-dependent affordance, the primary action inside
   thumb reach, and no critical control at the top of a tall screen.
