# Handoff: Currency Exchange Bureau — operations app (Group 1 + flows)

## Overview

An internal operational tool for a currency exchange bureau in Nouakchott, Mauritania.
The business buys foreign currency from suppliers and sells it to customers at negotiated
rates. Deals are frequently settled **only in part**, so the outstanding balance is carried
as debt and paid down later in installments. The business holds balances in several
currencies at once — **MRU** (the local currency, always one side of every exchange), plus
USD, EUR, MAD and others.

This bundle covers the design system and the first group of screens:

- The **Deal Card** component in all four of its contexts.
- **Sell currency** (the app's most complex form), with its reversed-rate warning and
  insufficient-balance error states.
- **Dashboard**, designed twice: with profit cards (owner) and without (employee).
- Two **playable user flows**: record a sale, and collect a customer payment.

It is the owner's operational tool. **It is not an accounting package and must not look or
feel like one.**

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes that show
the intended look, structure and behavior. They are **not production code to copy directly.**

The task is to **recreate these designs in the target codebase's existing environment**
(React, Vue, SwiftUI, Flutter, native, etc.) using its established patterns, component
library, routing and state management. If no environment exists yet, choose the framework
most appropriate for the project — a phone-first, offline-tolerant, bilingual RTL app — and
implement the designs there.

Specifically, do **not** port these implementation details:

- The prototype's inline-style approach. Use the codebase's styling solution.
- The prototype's `Component extends DCLogic` class and its `renderVals()` method. That is
  an artifact of the prototyping environment. Model the state as described in
  **State Management** below.
- The prototype's `<sc-if>` / `<sc-for>` / `{{ hole }}` template syntax.
- The step-navigation shell in the flows file (tabs, "Lecture" autoplay, the right-hand
  motion commentary panel). Those exist to *present* the flows to stakeholders. The real app
  has ordinary navigation. **Everything inside the phone frame is real product UI.**

## Fidelity

**High-fidelity (hifi).** Colors, typography, spacing, radii, copy and motion timings are
final and intentional. Recreate the UI to match, using the codebase's libraries where they
can express these values. Where a codebase primitive differs from the mock, prefer the
codebase primitive but preserve the exact color/type/spacing tokens listed below — several of
them are correctness features, not taste (see **The three numbers**).

The one deliberately unfinished area: the desktop layouts. Everything here is specified at
phone width (390px). Desktop is a later pass.

---

## The three numbers — read this before writing any UI

Three values look similar and mean completely different things:

| Value | Meaning | Example |
| --- | --- | --- |
| **Value** (`valeur du deal`) | What the deal was worth | 164,000 MRU |
| **Cash** (`payé maintenant`) | What actually changed hands | 100,000 MRU |
| **Debt** (`reste dû`) | What is still owed | 64,000 MRU |

A design that lets these blur into each other **loses the owner money.**

Hard rules, no exceptions:

1. Every surface that shows a deal shows **all three**, distinctly labelled — or shows
   **exactly one** and makes unmistakable which it is.
2. There is **no context** in this product where they may be summed, or where a single
   figure may stand in for the deal.
3. **Amounts in different currencies are never added together.** 2,000 USD and 500 EUR are
   two facts, not one. Any total is either absent or explicitly labelled as an MRU
   equivalent.
4. **Debts are never netted.** A contact who is both customer and supplier shows both
   balances side by side with no total between them.

A rendered money figure must **always be derived from its input**, never from animation or
cache state. This is implemented in the prototype and must be preserved: see
**Interactions → Number ticker** for the specific failure mode this prevents.

### The reversed-rate hazard

Entering `39` where `1/39` was meant produces a plausible-looking transaction off by a
factor of ~1,500, and it **saves cleanly**. The rate field needs defences that a hurried
person notices without being stopped. See **Sell currency → Rate field**.

---

## Users & physical context

- **The owner** — checks balances, debts and profit several times a day, mostly on a phone,
  sometimes on a laptop. Sees everything.
- **One or two employees** — record deals at the counter while a customer waits. They can
  see balances and record transactions. They **cannot see profit**; that is a permission the
  owner withholds.

The employee dashboard is a **real layout, not the owner's layout with gaps in it.** See
**Dashboard (employee)**.

Physical context that drove real decisions:

- Used **standing up, one-handed**, often **outdoors in bright sun**, at speed, with a
  customer waiting. → Light-first, high contrast. Cards are delimited by a **hairline
  border, not a shadow** (a shadow says nothing in sunlight). No dark theme in this pass.
- Amounts are **transcribed from paper and from other phone screens**. → Tabular mono
  figures, Western digits in both languages, thousand separators.
- The primary action of every screen sits **within thumb reach**.

---

## Design Tokens

### Color

| Token | Hex | Role |
| --- | --- | --- |
| `--ink` | `#0B1220` | Text; also app chrome (title bar, tab bar, the live outstanding band) |
| `--muted` | `#5A6B7C` | Secondary text, labels |
| `--surface` | `#F5F7F9` | Screen background — faint blue cast, **not cream** |
| `--hairline` | `#DCE2E8` | Rules, borders, table dividers |
| `--in` | `#0B6E5F` | Money in — deep teal-green |
| `--out` | `#A8500F` | Money out — burnt ochre |
| `--danger` | `#B4231F` | Destructive actions and blocking errors only, nothing else |

Derived values (all in use; add them as real tokens):

| Token | Hex | Role |
| --- | --- | --- |
| `--in-text` | `#0A5548` | `in` as text on white/tint (4.5:1) |
| `--in-strong` | `#0B5A4E` | `in` on a tinted surface where `#0B6E5F` fell below 4.5:1 |
| `--in-tint` | `#E6F1EF` | in-side fills (chips, cash-in card) |
| `--in-tint-border` | `#BFDBD5` | border for `--in-tint` surfaces |
| `--in-tint-soft` | `#F2F8F6` | in-side table half |
| `--out-text` | `#8C420C` | `out` as text |
| `--out-text-deep` | `#7A3A0A` | body copy inside an out-tinted warning |
| `--out-tint` | `#FDF0E6` | out-side fills |
| `--out-tint-border` | `#E8C39C` / `#EBCBAC` | border for out-tinted warning / card |
| `--danger-text` | `#8E1C19` | error copy |
| `--danger-tint` | `#FBEAE9` | offline banner fill |
| `--danger-tint-border` | `#E2B9B7` | offline banner border |
| `--on-ink` | `#F5F7F9` | text on ink |
| `--on-ink-bright` | `#FFFFFF` | the primary figure on ink; active tab label |
| `--on-ink-muted` | `#93A3B4` | labels on ink |
| `--on-ink-dim` | `#AEBBCB` | back chevron on ink |
| `--on-ink-hairline` | `#16233A` | rule on ink |
| `--on-ink-raised` | `#33415C` | avatar / bordered chip on ink |
| `--ink-2` | `#3E4C5A` | inactive control label |
| `--hairline-soft` | `#F0F3F5` | list row divider (lighter than `--hairline`) |
| `--hairline-strong` | `#C6CFD7` | device edge, sheet handle, dashed affordance |
| `--skeleton` | `#EAEEF1` | skeleton block |
| `--disabled-bg` | `#EEF1F4` | disabled button fill |
| `--disabled-text` | `#9AA6B2` | disabled button label |
| `--receipt-dash` | `#C6CFD7` | dashed rule on the receipt |

**Direction is never carried by color alone.** Money in and money out always carry a
**sign** (`+` / `−`) and a **word** (Entrée / Sortie) as well as a hue. Roughly one man in
twelve in this region cannot reliably separate the teal from the ochre. This is not
optional.

### Typography

Two families, and the pairing is the point.

- **`IBM Plex Sans Arabic`** — all interface text, both Arabic and Latin. One family across
  both scripts keeps the bilingual UI coherent in a way a mixed pairing cannot.
- **`IBM Plex Mono`** — every monetary value, rate and reference, with
  `font-variant-numeric: tabular-nums`. Numbers in the same column align digit for digit.
  **This is the signature: the money is set in a different voice from the words around it.**

The mono stack must fall back to the Arabic sans so Arabic labels that sit inside a mono run
still shape correctly:

```
font-family: 'IBM Plex Mono', 'IBM Plex Sans Arabic', monospace;
```

Weights loaded: Sans Arabic 400/500/600/700, Mono 400/500/600.

**Money scale** (mono, 600, tabular):

| Name | Size / line-height | Use |
| --- | --- | --- |
| `money-xl` | 40 / 1.0 | The deal's two figures on the confirmation step |
| `money-lg` | 30 / 1.0 | The live outstanding figure; a balance card on the employee dashboard |
| `money-lg-alt` | 26 / 1.05–1.1 | Amount inputs; owner balance cards |
| `money-md` | 18–19 / 1.2 | Column figures, the three-figure band |
| `money-row` | 15–17 / 1.3 | List-row amounts |
| `money-sm` | 11–13 / 1.3 | Rates, references, timestamps, currency codes |

**Text scale** (Sans Arabic):

| Name | Size / line-height / weight | Use |
| --- | --- | --- |
| `title` | 22 / 1.25 / 600 | Screen titles at desktop |
| `nav-title` | 15 / 1.2 / 600 | Title-bar label |
| `strong` | 14–15 / 1.4 / 600 | Contact names, row titles, field labels (12/600 at field level) |
| `body` | 14 / 1.5 / 400 | Prose |
| `caption` | 12–12.5 / 1.45–1.55 / 500 | Secondary lines, explanatory notes |
| `label` | 11 / 1.2 / 600, `letter-spacing: .09em`, uppercase | Section and field-group labels |
| `label-sm` | 10–10.5 / 1.3 / 600, `letter-spacing: .06–.08em`, uppercase | Chip and band labels |

**Amounts get real size — the primary figure on a screen is the largest thing on it.**

### Spacing, radii, elevation

- Spacing scale: **4, 8, 12, 16, 24, 32, 48**. Dashboard density, not marketing-page density.
  Card padding 13–14px (phone) / 18–20px (confirmation, rationale). Screen padding 16px.
  Section gap 18–20px. Field gap 14px.
- Radii: **6** (inner chips, small controls) · **8** (fields, buttons, tinted callouts) ·
  **10** (cards, primary button) · **14–18** (sheet, state-detail card) · **22–26** (device
  frame) · **999** (pills, avatars, FAB).
- Elevation: **none by default** — cards use a 1px hairline border. Exceptions:
  bottom sheet `0 -8px 32px rgba(11,18,32,.18)`; FAB `0 3px 12px rgba(11,110,95,.4)`;
  segmented-control thumb `0 1px 3px rgba(11,18,32,.1)`; the device frame in the mock only.
- Hairlines: `1px solid var(--hairline)` for structure, `var(--hairline-soft)` between list
  rows, `1px dashed var(--receipt-dash)` on the receipt.

### Quality floor — non-negotiable

- Touch targets **44×44px minimum, 8px apart**. Nothing important depends on hover.
- Text contrast **4.5:1 or better**. Visible keyboard focus, **never removed**.
- Every form field has a **visible label**. Placeholders are examples, not labels.
- Errors appear **next to the field that caused them** and carry the **real numbers**:
  "Only 9,250 USD available", not "Insufficient balance".
- Amount fields open a **numeric keypad**, insert **thousand separators as the user types**
  (space as separator: `164 000`), and respect each currency's decimal places.
- Bottom navigation: **five items maximum**.
- Every list is **paginated**, and has a designed **loading skeleton** and **empty state**.
  The empty state names the action that fills it.
- **Offline state**: a persistent banner that **pushes content down rather than covering
  it**, and every submit button disabled. An unsent transaction must **never** appear as if
  it saved.

---

## Bilingual & RTL

Arabic and French, switchable at runtime, **including on the login screen** — a user who
cannot read the interface cannot sign in to change it.

- **Full RTL for Arabic.** Use logical CSS properties throughout
  (`padding-inline-start`, `border-inline-end`, `inset-inline-end`, `margin-inline`),
  **never `left`/`right`**. The prototype does this; the layouts mirror with no per-language
  overrides.
- Mirror layout, navigation and icon direction. The back chevron flips (`‹` → `›`).
- Do **not** mirror numerals, charts, or the money column.
- **Amounts, rates and references always render in Western digits (0–9), in both
  languages.** Only prose and dates localise. Deliberate: operators transcribe figures from
  paper and other screens at speed, and mixed digit systems invite errors.
  **⚠ Confirm with the client** — see **Open questions**.
- Every numeral run adjacent to Arabic text must be **bidi-isolated at the number itself**,
  not merely on its container, or digit groups reorder:
  ```html
  <span style="direction:ltr; unicode-bidi:isolate">45 000 MRU · +222 44 12 88 07</span>
  ```
  For figures inside a translated string, wrap them in `U+2066 … U+2069` (LRI…PDI) in the
  string itself.
- **Arabic text runs longer than French. Design for it rather than truncating.** Give label
  slots a `min-height` (the three-figure band uses `min-height: 26px` on its labels so the
  figures keep a shared baseline in both languages).

---

## Screens / Views

Phone width throughout: **390px**. Device frame in the mocks is presentation only.

### App chrome (all screens)

**Title bar** — `--ink` background, `min-height: 52px`, padding `10px 16px`, `display: flex`,
`gap: 12px`, `align-items: center`.
- Back chevron `‹` (`›` in RTL), 20–22px, `--on-ink-dim`. Absent on a root screen.
- Title: `nav-title`, `--on-ink`, `flex: 1`.
- Language switcher: bordered chip, `1px solid var(--on-ink-raised)`, radius 6, padding
  `6px 8px`, mono 11–12/600, `--on-ink-muted`, label `FR ع` / `ع FR`.
- Avatar (dashboard only): 32px circle. Owner `--on-ink` bg with `--ink` initials (inverted,
  signalling the owner); employee `--on-ink-raised` bg with `#E7ECF1` initials.

**Bottom tab bar** — `--ink` background, `border-top: 1px solid var(--on-ink-hairline)`,
`min-height: 64px`, `padding-bottom: 6px`.
`grid-template-columns: 1fr 1fr 76px 1fr 1fr` — five slots, centre one is the FAB.
- Items: Accueil `▤` · Opérations `⇄` · **FAB** · Dettes `≡` · Plus `⋯`.
- Item = glyph (mono 15px) above label (11px). Active: `--on-ink-bright`, weight 600.
  Inactive: `--on-ink-muted`, weight 500.
- **FAB**: 56px circle, `--in` fill, white `+` at 26px, `margin-top: -18px` to break the
  bar's top edge, shadow `0 3px 12px rgba(11,110,95,.4)`. The most-used control is the only
  saturated thing in the chrome.

**Primary action bar** — sits above the tab bar, white, `border-top: 1px solid
var(--hairline)`, padding `12px 16px 14px`. Button is full-width, `min-height: 56px`,
radius 10, `--ink` fill, `--on-ink` label at 16/600. Disabled: `--disabled-bg` fill,
`--disabled-text` label, `cursor: not-allowed`, plus a caption stating why.

**Offline banner** — `--danger-tint` fill, `1px solid var(--danger-tint-border)`,
padding `10px 16px`, a mono `!` in `--danger` then the message in `--danger-text` at
12.5/1.45. Sits **between the title bar and the content, in flow** — it pushes content down.
All submits disable while it is shown.

---

### 1. Deal Card — the signature component

Renders one exchange. The **same component** appears in the form preview, the confirmation
step, the printed receipt, and the list row, so a deal is recognisable at every point in its
life. Structure is constant; only density and surface change.

```
┌─────────────────────────────────────────────┐
│  YOU GIVE                      − SORTIE     │
│  4 000  USD                                 │
│  ─────────  1 USD = 41.0000 MRU  ─────────  │
│  YOU GET                       + ENTRÉE     │
│  164 000  MRU                               │
├─────────────────────────────────────────────┤
│  Payé maintenant      100 000 MRU           │
│  Reste dû              64 000 MRU           │
└─────────────────────────────────────────────┘
```

**Anatomy**

- **Body** — white, `1px solid var(--hairline)`, radius 10, `overflow: hidden`.
- **Half label row** — `display: flex; gap: 8px; align-items: center`. The `label` text
  (YOU GIVE / YOU GET), then a **direction chip**:
  - out: `--out-tint` fill, `--out-text` text, radius 4, padding `2px 6px`,
    `label-sm`, content = mono `−` + the word `Sortie`.
  - in: `--in-tint` fill, `--in-text` text, same geometry, mono `+` + `Entrée`.
- **Figure row** — `display: flex; align-items: baseline; gap: 8–10px`. Amount in the money
  scale for the context; currency code in mono at ~40% of the figure size, `--muted`.
- **Rate divider** — `display: grid; grid-template-columns: 1fr auto 1fr; gap: 10–12px;
  align-items: center`. Two 1px `--hairline` rules flanking the plain-language rate echo, in
  mono, tabular: `1 USD = 41.0000 MRU`. **Always four decimal places.**
- **Settlement footer** — `--surface` fill (white on the receipt),
  `border-top: 1px solid var(--hairline)`.

**Context A — form preview** (360px). `money-lg-alt` figures, footer is two label/value rows
(`justify-content: space-between`), *Payé* value in `--in-strong` prefixed `+`, *Reste dû* in
`--ink`. Recomputes on every keystroke.

**Context B — confirmation** (390px, the widest). `money-xl` figures. Footer is the
**three-figure band**: `display: grid; grid-template-columns: auto auto auto;
justify-content: space-between`. Each cell = `label-sm` (with `min-height: 26px` for Arabic),
then a `money-md` figure with `white-space: nowrap`, then a mono 11px qualifier line
(`MRU`, `MRU · encaissé`, `MRU · à recevoir`). Cells 2 and 3 carry
`border-inline-start: 1px solid var(--hairline)`. Below the band, above a hairline: *"Ces
trois chiffres ne s'additionnent pas."* — the app's one place where it teaches the
distinction outright.

**Context C — receipt** (320px). White paper, dashed `--receipt-dash` rules instead of solid.
Header: bureau name (`label`-ish 12/600, `letter-spacing: .06em`, uppercase) and mono
timestamp. `money-lg-alt` figures. Footer: three label/value rows (Valeur du deal / Payé
maintenant · <method> / Reste dû). Foot: mono `RÉF 2026-0731-0142` and the operator + till.
**Same figures at the same relative positions as B — only the medium changes.**

**Context D — list row** (390px). Three text lines, `gap: 7px`, `min-height: 44px`,
padding `12px 16px`, divided by `--hairline-soft`:
1. Contact name (`strong`) + payment-status chip, `justify-content: space-between`.
2. `grid-template-columns: 1fr auto 1fr` — given amount · mono `→ 41.0000 →` · received
   amount (`text-align: end`). Both at `money-row` 16px.
3. Mono timestamp · settlement summary: `+100 000` in `--in-strong`, then `· dû ` in
   `--muted`, then the debt figure in `--ink`, then ` MRU`.

**A list row keeps all three numbers.** This costs density — six or seven deals per screen
instead of fifteen — and that cost is accepted deliberately. See **Rationale**.

**Reversed row variant**: `#FBFCFD` background, name and both figures `--muted` with
`text-decoration: line-through`, a lifecycle chip reading `CONTRE-PASSÉE`, and a caption
naming who reversed it and why. **Nothing is ever deleted; entries are reversed and stay
visible.**

---

### 2. Status chips — two visually distinct families

They must not be confusable at arm's length.

**Payment status — tinted pill with a dot.** `border-radius: 999px`, padding `5px 11px`
(3px 9px inline in a row), 11–12/600, a 6px dot before the label.
| State | Fill | Text | Dot |
| --- | --- | --- | --- |
| Payé | `--in-tint` | `--in-text` | `--in` |
| Partiel | `--out-tint` | `--out-text` | `--out` |
| Non payé | `--disabled-bg` | `--ink-2` | `--muted` |

**Lifecycle — angular mono frame, no fill.** `border: 1px solid`, `border-radius: 4px`,
padding `4px 8px`, mono 10–11/600, `letter-spacing: .06em`, uppercase.
| State | Border | Text |
| --- | --- | --- |
| `ACTIVE` | `#B6C0CA` | `--ink-2` |
| `CONTRE-PASSÉE` | `#C9A9A8` | `--danger-text` |
| `OUVERTURE` | `#B6C0CA` | `--ink-2` |

---

### 3. Sell currency (S-06)

The app's most complex form. Sections are separate white cards on `--surface`, `gap: 16px`.

**Contact picker (selected state)** — white card, `min-height: 52px`, radius 8. 32px avatar
(`--ink` fill, `--on-ink` initials) · name (`strong`) over a mono caption carrying the
contact's **current debt and phone** · a `Changer` affordance in `--muted` 12px.
The debt is visible **before** the deal is entered.

**Exchange card** — three fields, `gap: 14px`:

1. **Vous livrez** (`youDeliver`) — label 12/600. Field `min-height: 56px`, radius 8,
   `1px solid var(--ink)` (the focus/primary field). Amount `money-lg-alt`, `flex: 1`.
   Trailing **currency picker**: inline chip, `min-height: 40px`, `--surface` fill,
   `1px solid var(--hairline)`, radius 6, mono 14/600 + a 10px `▾`. Below: mono 11.5px
   `Disponible 9 250 USD` in `--muted`.
2. **Total MRU** — label carries a **`FIXE` badge** (mono 10/600, `letter-spacing: .06em`,
   bordered, radius 4) because **one side of the exchange is always MRU and is labelled as
   fixed**. Field is `--surface`-filled with a `--hairline` border (derived, still editable).
   Caption: *"Dérivé du montant et du taux. Modifiable : le taux se recalcule."*
3. **Taux** — see below.

**Rate field — the defended input.** `min-height: 52px`, radius 8, mono 22/600 value,
trailing mono 12px unit `MRU / USD`. Under it, always: the **plain-language echo**
`1 USD = 41.0000 MRU` at mono 13/500 — and under that, the last recorded rate and the
delta: `Dernier taux enregistré 40.8000 · écart +0,5 %`.

*Reversed-rate warning state* (warns, does **not** block):
- Field border becomes `2px solid var(--out)`.
- The field plays a **shake** (see Interactions) — motion, not just color.
- A callout appears below: `--out-tint` fill, `1px solid var(--out-tint-border)`, radius 8,
  padding 12. Mono `▲` in `--out-text`; title *"Ce taux est peut-être inversé."*
  (13/600, `--out-text-deep`); the echo restated at the entered value
  (`1 USD = 0.0244 MRU`); then the reasoning **with real numbers**: *"Le dernier taux
  enregistré pour USD → MRU est 40,8000. Vous avez saisi 0,0244, soit 1/41. Vérifiez le sens
  avant de continuer."*
- Two 44px actions: **`Utiliser 41.0000`** (filled `--out-text`, white label — applies the
  inverse) and **`Garder 0.0244`** (outline, `--out-text-deep`).
- The derived MRU total also shows its absurd result (`98 MRU`) in `--out-text`, with
  *"Total attendu autour de 164 000 MRU pour 4 000 USD."*
- The user can proceed. It must be **noticeable without being a wall.**

*Insufficient-balance error state* (**blocks**):
- Field border `2px solid var(--danger)`.
- Below the field: mono `✕` in `--danger`, then *"Seulement 9 250 USD disponibles."*
  (13/600, `--danger-text`) and a mono line `Manque 2 750 USD`.
- Primary button disabled, with the caption *"Réduisez le montant livré, ou achetez d'abord
  des USD."* — **an error names the way out.**

**Payment card**:
- **Reçu maintenant** — `min-height: 56px`, `1px solid var(--ink)`, `money-lg-alt` value,
  numeric keypad, thousand separators inserted while typing, capped at the deal value.
- **Shortcuts** — pill buttons, `min-height: 44px`, radius 999, `--surface` fill,
  `1px solid var(--hairline)`, 13/600: `Tout` · `Rien` (the mock adds `100 000` as a partial
  example).
- **Mode de paiement** — chip row, `gap: 8px`, wraps. Each `min-height: 44px`, padding
  `0 14px`, radius 8. Selected: `--ink` fill, `--on-ink` label, 600. Unselected: white,
  `--hairline` border, 500. Methods: **Bankily · Espèces · Masrivi · Sedad**.

**Live settlement summary** — the Deal Card's footer, promoted:
- Two rows on white: *Valeur du deal* `164 000 MRU` · *Payé maintenant* `+ 100 000 MRU`
  (`--in-strong`).
- Then the **outstanding band**: `--ink` fill, padding `16px 14px`,
  `justify-content: space-between`, `align-items: baseline`. Label in `--on-ink-muted`
  (`label` at 12px), figure at **`money-lg` 30px in `--on-ink-bright`** with a 14px
  `--on-ink-muted` `MRU`. **This is the loudest thing on the screen, and it moves as the
  user types.** The single place motion earns its keep.

**Primary action**: `Vérifier la vente` → confirmation step.

**Empty state** (trades list): 38px bordered glyph tile `⇄`, title 14/600, caption 12/1.5,
then a 44px `--ink` button — *"Aucune opération aujourd'hui / Les ventes et achats
enregistrés au comptoir apparaîtront ici. / Enregistrer une vente."* The empty state names
the action that fills it.

**Loading skeleton**: blocks in `--skeleton` / `--hairline-soft` at radius 3–4, in the shape
of the result (label bar 12px tall at 44–60% width, value bar 20–32px at 66–85%), divided by
`--hairline-soft`. Shimmer sweeps across them.

---

### 4. Dashboard — owner (S-04)

Period + currency selector bar (white, under the title bar): two `min-height: 40px`
segments, `gap: 8px`. Active: `--ink` fill, `--on-ink` label. Inactive: `--hairline` border,
`--ink-2` label. Each ends in a 10px `▾`. Content: `Aujourd'hui` · `Toutes devises`.

Then, `padding: 16px`, `gap: 20px`:

1. **Soldes par devise** — `label` header with a `Tout voir` link. Horizontal scroller
   (`overflow-x: auto`, `gap: 10px`, `padding-bottom: 6px`) of `box-sizing: border-box`
   fixed-width cards — **168 / 148 / 130px**, so the third peeks and the strip reads as
   scrollable. Each card: a **currency chip** (mono 11/600, `--ink` fill, `#E7ECF1` text,
   radius 4, padding `2px 7px`, `letter-spacing: .06em` — an echo of the rate board), then
   `money-lg-alt` 26px `white-space: nowrap`, then a caption.
   **Low-balance state**: card border `--out-tint-border`, and a caption line in
   `--out-text` 11/600: mono `▲` + `Sous le seuil de 10 000`.
   Under the strip: *"Chaque devise reste séparée. Aucun total toutes devises confondues."*
2. **Caisse du jour** — two cards, `flex: 1` each. In: `--in-tint` fill,
   `--in-tint-border` border, `border-inline-start: 3px solid var(--in)`. Out: `--out-tint` /
   `--out-tint-border` / `3px solid var(--out)`. Each: sign + word header (mono `+`/`−` then
   Entrée/Sortie, 12/600 in `--in-text`/`--out-text`), a 24px mono figure, then
   `MRU · 7 mouvements`. **Cash in and cash out are two separate figures, never a net.**
3. **Dettes** — one card, `grid-template-columns: 1fr 1fr`. Left half `--in-tint-soft`
   (*On nous doit*, header `--in-text`), right half `#FEF8F2` (*Nous devons*, header
   `--out-text`), divided by `border-inline-end: 1px solid var(--hairline)`. Inside each: one
   row **per currency** — mono currency code (11px `--muted`, `align-self: center`) and a
   16px figure, `justify-content: space-between`. Footer strip on `--surface`:
   *"Créances et dettes ne se compensent pas, même pour un même contact."*
4. **Résumé de la période** — 2×2 grid: Ventes · Achats · **Bénéfice brut** · **Bénéfice
   net**. Each: 12/500 `--muted` label, 20px mono figure, mono 11px qualifier
   (`MRU en valeur`, `MRU · coût moyen pondéré`, `MRU · − dépenses 17 250`). Profit figures in
   `--in-strong` prefixed `+`. **Owner only.**
5. **Activité récente** — `label` header + `Tout voir`. Deal rows condensed to two lines:
   name over mono `11:42 · vente · 4 000 USD`; right side, mono, `text-align: end`: cash
   delta (`+ 100 000` `--in-strong` / `− 102 000` `--out-text`) over `dû 64 000` in `--muted`.
   **Even the condensed row carries cash and debt separately.**

### 5. Dashboard — employee (no `profit:view`)

**Not the owner's screen with holes in it.** The profit cards are gone, and the freed space
goes to two things the employee actually looks at:

- **Balances become a 2×2 grid** (`grid-template-columns: 1fr 1fr`, `gap: 10px`), four
  currencies visible without scrolling, figures stepped up to **`money-lg` 30px** with
  `white-space: nowrap`. Cards get `padding: 14px`.
- **Ma journée** replaces the period summary: one card, three equal columns divided by
  `border-inline: 1px solid var(--hairline)`, each a centered 24px mono count over an
  11.5px `--muted` label — *opérations saisies · partiellement payées · encaissements*.

Identical to the owner's: balances, separated cash in/out, per-currency debts, recent
activity. Avatar style differs (see chrome). **The employee records and checks; they do not
measure margin.**

There is **no blurred or locked profit card.** Absence is more honest than an exhibited
secret.

---

### 6. Flow: record a sale (6 steps)

`Accueil → Choisir le contact → Saisir l'opération → Réviser → Enregistrement → Enregistrée`

- **Choisir le contact** — a **bottom sheet over the live dashboard**. The dashboard stays
  mounted; the scrim (`rgba(11,18,32,.28)`) is an **absolutely positioned overlay**
  (`position: absolute; inset: 0; z-index: 2`) inside the screen container, `justify-content:
  flex-end`. Sheet: `--surface` fill, `border-radius: 18px 18px 0 0`, padding
  `14px 16px 20px`, a 38×4px `--hairline-strong` handle centered above the title, then a
  search field (`min-height: 48px`) and the contact list. Rows are 56px, each showing the
  contact's **open debt and its age** (`dû 45 000 MRU · 12 j`) — or `client et fournisseur`
  for the dual-role case. The sheet must rise **over the screen it came from.**
- **Réviser** — the Deal Card in confirmation context; primary action becomes
  `Enregistrer la vente`.
- **Enregistrement** — skeleton in the shape of the result + a pulsing status dot.
- **Enregistrée** — success mark, reference, and the **receipt** context of the Deal Card.

### 7. Flow: collect a customer payment (3 steps)

`Dettes → Encaisser → Encaissé`

- **Dettes** — segmented control (`--disabled-bg` track, radius 999, 3px padding, white
  thumb with `0 1px 3px rgba(11,18,32,.1)`): *On nous doit* / *Nous devons*. Then a
  per-currency total card in `--in-tint-soft`, then debtor rows carrying **age in days** and
  the outstanding figure.
- **Encaisser** — **debt picker**: each open debt as a radio row (20px circle; selected =
  `6px solid var(--in)` ring, row tinted `--in-tint-soft`) showing its origin, date, **age**
  and outstanding amount. Then a **capped amount field**, the payment-method picker, and an
  ink band showing **Reste après paiement** with a live ticker.
  *Over-cap state*: field border `--danger`, field shakes, error reads *"Cette dette ne
  dépasse pas 30 000 MRU."*, and the band **relabels to `Reste — montant à corriger`** so an
  invalid amount never presents itself as a settled outcome.
- **Encaissé** — *Encaissé · Dette avant · Dette après*, three rows, **no net balance.**

---

## Interactions & Behavior

**Motion rules**

- **Ease-out, 160–260ms.** Everything that responds to a finger starts fast and finishes
  slow. Nothing exceeds 300ms — these screens are seen fifty times a day. Curve in use:
  `cubic-bezier(.22, .68, .24, 1)`. State changes (color, border) 150–200ms.
- **One place bounces**: the success mark's `popIn`, once per operation. No overshoot
  anywhere else.
- **Direction-aware**: forward slides in from the end, back from the start — expressed
  logically, so RTL inverts with no extra code.
- **Errors are a wiggle, not a color**: shake draws the eye; the sign and word carry meaning.
- **`prefers-reduced-motion: reduce` removes everything** — CSS animations/transitions *and*
  the JS ticker. States must stay legible with zero motion.

**Named effects and where they belong**

| Effect | Where | Spec |
| --- | --- | --- |
| **Stagger** | Dashboard balance cards | `fadeUp` at 0 / 40 / 90 / 140ms, 220–240ms each |
| **Fade up** | Section entrances | `opacity 0→1`, `translateY(10px)→0`, 220ms ease-out |
| **Slide in (sheet)** | Contact picker | `translateY(100%)→0`, 260ms; scrim fades in 200ms |
| **Direction-aware transition** | Step changes | ±28px + fade, 240ms |
| **Number ticker** | Outstanding figure; Reste après paiement | ~320ms, cubic ease-out |
| **Tabular numbers** | Every figure | Fixed-width digits — the column cannot jitter mid-change |
| **Shake / Wiggle** | Rate field; over-cap amount | 380ms, ±6/5/3/2px decaying |
| **Skeleton / Shimmer** | Saving step | Sweep `-180px → 180px`, 1.1s linear infinite |
| **Pulse** | Saving status dot | `opacity 1 → .45 → 1`, 1s infinite |
| **Pop in** | Success mark | `scale .86 → 1.04 → 1`, 420ms |
| **Ripple** | Success mark | Ring `scale .6 → 1.9`, `opacity .5 → 0`, 700ms, once |
| **Orchestration** | Success screen | mark 0 · title 120 · receipt 180 · button 240ms |
| **Press feedback** | All buttons, list rows | `scale(.96–.985)` on `:active` (rows tint instead) |

**Number ticker — implement it this way, the reason is correctness**

The naive implementation animates a mirror value and renders that. It has a failure mode
that is exactly the hazard §3 of the brief exists to prevent: if frames are starved
(background tab, heavy thread), the mirror never reaches its target and **a valid input is
displayed with the wrong number**.

Required shape:

1. The rendered figure is **always derived from the input** — `164000 - paid`,
   `max(0, 45000 - min(collect, cap))`.
2. A tween holds only the value being travelled **from**, plus progress `p`; the displayed
   value is `lerp(from, truth, ease(p))`.
3. The tween is ended by a **timer** (`setTimeout(duration + 60)`), not by the frame loop.
   A starved rAF therefore degrades to *no animation*, never to *wrong number*.
4. Cancel and clear the tween on step change, flow change and unmount.
5. If `prefers-reduced-motion` matches, skip the tween entirely and land on the value.

**Form behavior**

- Amount fields: numeric keypad, thousand separators (space) as the user types, per-currency
  decimals, capped to the relevant maximum (deal value; debt outstanding).
- MRU total and rate are **mutually derived**: editing the total recomputes the rate and vice
  versa. The MRU side is always labelled `FIXE`.
- Rate echoes in plain language on every change, at four decimals.
- Reversed-rate check fires on blur/change against the last recorded rate for that pair:
  if the entered value is within tolerance of `1 / lastRate`, warn (never block).
- Balance check blocks submission and states the shortfall.
- Reversal (trade detail) requires a **typed reason**; nothing is ever deleted.
- Offline: banner in flow, all submits disabled, no optimistic "saved" state.

---

## State Management

Model these; the prototype's class is not a template.

**Sell form**
- `contactId`, `deliverAmount`, `deliverCurrency`, `mruTotal`, `rate`, `paidNow`,
  `paymentMethod`.
- Derived: `dealValue = mruTotal`, `outstanding = dealValue - paidNow`.
- Validation: `rateLooksReversed` (vs last recorded rate for the pair),
  `insufficientBalance` (+ `shortfall`), `paidNow ≤ dealValue`.
- Reference data: available balance per currency, last recorded rate per pair, contact's
  current debt.

**Collect payment**
- `debtId`, `amount` (capped at that debt's outstanding), `paymentMethod`.
- Derived: `remainingAfter = outstanding - min(amount, outstanding)`, `overCap`.

**Dashboard**
- `period`, `currencyFilter`, `permissions` (`profit:view`), balances per currency with
  per-currency low-balance thresholds, period cash-in / cash-out, receivables and payables
  **per currency**, recent activity page.

**Session / app**
- `language` (`fr` | `ar`) with `dir` derived, `role` + permission set, `online`.
- Language is switchable at runtime **including on the login screen**.

**Ticker (per animated figure)**
- `tween: { key, from, p } | null` — never the displayed value itself.

**Data fetching** — every list paginated, with skeleton and empty states. Nothing here needs
real-time updates; refresh on focus and after a mutation is sufficient.

---

## Assets

**None.** No images, icons-as-files, illustrations or mascot. Every glyph in the mocks is a
Unicode character set in one of the two families:
`‹ › ▾ ▤ ⇄ ≡ ⋯ + − ✓ ✕ ▲ ⌕ • ❙❙ ▶ → ←`.

If the target platform has an icon set, substituting equivalents is fine — keep them
monoline and quiet, and **keep the sign glyphs (`+` `−`) in the mono family** so they align
with the figures they qualify.

**Fonts**: `IBM Plex Sans Arabic` and `IBM Plex Mono` (SIL Open Font License). Loaded from
Google Fonts in the mocks; self-host in production.

---

## Out of scope

No marketing or landing page. No onboarding tour. No charts beyond a simple bar or line in
reports — this product's data is tabular and should stay that way. No notifications. No dark
theme in the first pass. No illustration or mascot.

---

## Rationale — the direction, the risk, what was rejected

**The direction.** The exchange board and the ledger column: figures in rows, and nothing
competing with them. Tabular mono is not an effect — it is what makes a column of debts
readable at a glance. Cards are delimited by a hairline rather than a shadow, because a
shadow says nothing in direct sun. `--ink` dresses the *chrome* — title bar, tab bar, and the
outstanding band — so hierarchy comes from the frame while the body stays light. The two
hues serve only meaning, in and out, and always arrive after a sign and a word. **No color
field sits behind an amount.**

**The risk taken.** The Deal Card refuses the "one row, one amount" format every financial
list converges on. A list row here occupies three lines and keeps given, received, paid and
owed. So you see six or seven operations per screen, not fifteen. That density cost is
accepted knowingly: **the list where you only see `164 000` is the list where you believe you
were paid.**

**Rejected.** The single total at the top of the dashboard, in all its forms. Sparklines —
twelve points say nothing a column says better. The cream background with a high-contrast
serif; the near-black background with one acid accent; the broadsheet layout with hairline
rules and zero radius — three reflexes, not three choices. A delete gesture: nothing is
erased, entries are reversed. And the blurred-profit trick: absence is more honest than an
exhibited secret.

## Open questions for the client — confirm before building

1. **Western digits (0–9) in Arabic.** Chosen here for transcription accuracy from paper.
   If the owner and staff read Arabic-Indic numerals more fluently, accuracy argues the other
   way and the rule should flip. **Ask; do not infer it from their interface language.**
2. **The mono.** If the interface needs to feel warmer, this is the first thing to drop —
   but **keep tabular figures whatever you do**, because misaligned columns in a debt list are
   a usability failure, not a taste question.

## Files

| File | What it is |
| --- | --- |
| `Exchange Bureau - Group 1.dc.html` | Tokens, the Deal Card in all four contexts, both chip families, the Sell screen with its warning/error/empty/skeleton states, both dashboards, and the written rationale. Has runtime **Français / العربية (RTL) / Hors ligne** toggles — use them to check every layout in both directions. |
| `Exchange Bureau - Flows.dc.html` | The two playable flows. Phone frame contents are product UI; the tabs, step list, "Lecture" autoplay and the dark motion-commentary panel are presentation scaffolding — do not build them. |
| `Exchange Bureau - Parcours (offline).html` | Self-contained offline copy of the flows, for reference without a server. |
| `README.md` | This document. Self-sufficient — build from it. |

## Screens not yet designed

Groups 2 and 3 of the brief, for scope awareness: trades list · trade detail with the
reversal dialog · debts overview with ageing buckets · receive customer payment (full
screen) · contact profile (including the dual-role customer-and-supplier case, shown side by
side with no total between them) · login with language switcher · currency ledger with
running balance and struck-through reversed entries · report viewer shell · add expense ·
settings, users and permission matrix, audit log. Desktop layouts for everything.
