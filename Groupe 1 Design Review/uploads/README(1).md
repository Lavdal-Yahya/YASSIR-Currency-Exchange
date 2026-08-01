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
| `tasks.md` | Phases and tasks with stable IDs, and each phase's Definition of Done. |
| `docs/architecture.md` | The structural rules every feature must fit. Read §3.3 twice. |
| `docs/conventions.md` | Git flow, code rules, testing, invariants, domain glossary. |
| `docs/decisions.md` | Why things are the way they are. Read before proposing a change. |
| `docs/schema-review.md` | The full table design, reviewed before the first financial migration. |
| `docs/screens.md` | Every screen, its purpose, its states, and which phase builds it. |
| `docs/design-prompt.md` | Paste-ready brief for the design system and components. |
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

```bash
ssh <vps>
cd /srv/<project> && git pull
docker compose run --rm api npx prisma migrate deploy
docker compose up -d --build
```

Take a manual database backup before every migration. Nightly automated backups
run to off-server storage — and a backup that has never been restored is not a
backup, so the restore rehearsal in P8-07 is not optional.

---

## Status

**Current phase:** Phase 1 — Foundation (not started)

One decision is open and blocks Phase 6: **D-016**, the reversal policy for a
purchase whose currency has since been sold. It needs the client's answer, not
ours.

Change requests accepted since the specification was signed: **D-020**, payment
method on cash movements (cash / Bankily / Masrivi / Sedad / other). Per spec
§48, anything else not in the spec needs documenting and approving before it is
built.
