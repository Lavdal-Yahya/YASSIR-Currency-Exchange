# Currency Exchange Management System

An internal operational system for a currency exchange business: buying and
selling currencies at negotiated rates, tracking what was actually paid versus
what is still owed on both sides, holding balances in several currencies at once,
and reporting real profit using weighted-average cost in a single base currency
(MRU).

It is **not** a statutory accounting system. It answers the fourteen operational
questions in §2 of the specification and nothing more.

**Stack:** NestJS + Prisma + PostgreSQL · React + Vite (mobile-first PWA, AR/FR)
· Docker Compose behind Traefik on a VPS

---

## Documentation — read in this order

| Doc | What it's for |
|---|---|
| `docs/spec.md` | The client specification. The source of truth for *what*. |
| `tasks.md` | Phases and tasks with stable IDs, grouped into v1 / v2 / v3, and each phase's Definition of Done. |
| `docs/architecture.md` | The structural rules every feature must fit. Read §3.3 twice. |
| `docs/conventions.md` | Git flow, code rules, testing, invariants, domain glossary. |
| `docs/decisions.md` | Why things are the way they are. Read before proposing a change. |
| `docs/schema-review.md` | The full table design, reviewed before the first financial migration (P2-13). |
| `docs/phases/phase-N.md` | The detail doc for the phase currently being built. |

New to the project? Read spec → tasks → architecture → conventions, then the
current phase doc.

Phase documents are written **one phase ahead, never all at once**. A detailed
plan written six phases early goes stale, and stale plans get followed anyway.

---

## Repository layout

```
api/     NestJS service — prisma/ for schema and migrations, src/ by module
web/     React PWA — features/ by domain area, shared/ for the rest
docs/    the documents above
```

---

## Prerequisites

- Node 20+
- Docker and Docker Compose

## Running locally

```bash
git clone <repo> && cd <repo>
cp .env.example .env
docker compose up -d db
npm install
npm --workspace api run prisma:migrate
npm --workspace api run seed
npm run dev            # api on :3000, web on :5173
```

## Tests

```bash
npm --workspace api run test           # unit
npm --workspace api run test:e2e       # integration, needs the db container
npm --workspace api run check:invariants -- --database-url=<url>
```

The integration suite verifies all eight standing invariants after **every**
test. The specification's §44 acceptance scenario runs as a fixed fixture and is
not permitted to be updated to match new behaviour — if it fails, the behaviour
is wrong.

---

## The three rules

1. **One path changes a balance.** `LedgerService.apply(tx, movements[])`. The
   transaction client is required, the locking order is sorted, and nothing else
   touches the ledger, balance, or cost tables. If you are about to write a
   balance update somewhere else, you have found a bug in the design — say so
   rather than working around it.
2. **Nothing financial is ever deleted.** Reversal is a compensating transaction
   that recomputes forward. The original row stays visible in history, with who
   reversed it and why.
3. **Value, cash, and debt are three different numbers.** A 164,000 MRU sale
   with 100,000 collected is not a 100,000 sale. Any screen or report that
   collapses them is wrong.

And one constraint that everything else leans on: **every trade has MRU on
exactly one leg** (D-019). A trade without one is rejected, not converted.

---

## Deployment

The production stack lives in `docker-compose.prod.yml`. All three services
(db, api, web) sit behind Coolify-managed Traefik on the Contabo VPS
(`207.180.202.96`), on the external `traefik-public` docker network. TLS is
issued by Let's Encrypt using the `letsencrypt` cert resolver and the
`websecure` HTTPS entrypoint (both Coolify defaults). See
`.env.production.example` for the required variables.

Prerequisite: an A record for `APP_HOST` pointing to `207.180.202.96` **must
resolve before starting the stack**, or Let's Encrypt refuses to issue the
cert and Traefik falls back to a self-signed one.

First-time bring-up:

```bash
ssh bouye@207.180.202.96
git clone git@github.com:Lavdal-Yahya/YASSIR-Currency-Exchange.git ~/apps/currency-exchange
cd ~/apps/currency-exchange
cp .env.production.example .env.production   # then edit — every :?required var
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npm --workspace api run seed
```

Ongoing deploys:

```bash
ssh bouye@207.180.202.96
cd ~/apps/currency-exchange && git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

Take a manual `pg_dump` before every deploy that touches a financial table.
Nightly automated backups run to off-server storage — and a backup that has
never been restored is not a backup, so the restore rehearsal in P8-07 is
not optional.

### VPS gotchas already applied

- Container names pinned to `cx-db` / `cx-api` / `cx-web` — another app on
  this host already has a service named `api`, so unique names avoid the
  DNS collision inside `traefik-public`.
- `api/src/main.ts` calls `app.listen(port, '0.0.0.0')` explicitly.
- If you rebuild only `web`, network state can go stale — run
  `up -d --build --force-recreate` when in doubt.

---

## Milestones

The eight phases ship as three releases. Every phase Definition of Done must
still pass — the milestone banner does not lower the gates.

| | Phases | What the client sees |
|---|---|---|
| **v1** — presentable auth + basics | P1 · P2 | Installable bilingual PWA, login, roles, master data. No money moves yet. |
| **v2** — dangerous core landed (~60–70%) | P3 · P4 · P5 | Ledger, trades, debts, expenses. §44 acceptance scenario green in CI. |
| **v3** — deployment ready | P6 · P7 · P8 | Reversal, profit, dashboard, rate feed, proven-restorable backups, handover. |

## Status

**Current milestone:** v2 · **Current phase:** Phase 3 — The ledger core

Active phase document: [`docs/phases/phase-3.md`](docs/phases/phase-3.md).
Phase 2 closed 2026-08-04 with the schema review signed off; v1 milestone
achieved. Phase documents are written **one phase ahead, never all at once**
— phase-4.md gets its refinement pass when phase-3 is closing out.

Open decisions: **D-023 item 3** — `allocation` FK shape (polymorphic vs
two nullable FKs). Pending, owner Lavdal, deadline ≤ P5-01. Does not block
P3. All other §9 open questions from the schema review closed in D-023.

Change requests accepted since the specification was signed:

- **D-020** — payment method on cash movements (cash / Bankily / Masrivi /
  Sedad / other). Per spec §48, anything else not in the spec needs documenting
  and approving before it is built.
