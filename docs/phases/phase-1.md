# Phase 1 — Foundation (Detail)

Scope: tasks P1-01 → P1-16.
Milestone: **v1**.

Goal: a bilingual PWA reachable over HTTPS on the VPS, installable to a phone
home screen, with a user who can log in with a phone number + PIN, whose
permissions are checked by the API on every request, and whose sensitive
actions land in the audit log. No financial code ships in this phase — the
only tables that exist after P1 are `user`, `role`, `permission`,
`role_permission`, `user_role`, `audit_log`, and Prisma's own bookkeeping.

The purpose of shipping this thin slice first is that everything after it
inherits its assumptions: cookie shape, guard convention, i18n key layout,
error envelope, timezone plumbing, migration workflow, deploy script. Getting
these wrong here is cheap; getting them wrong in Phase 4 is not.

---

## 0. Hard gate

None — this is the first phase, nothing has been deferred into it. The gate
mechanism starts biting in Phase 2 (which owns the schema review, P2-13).

---

## 1. PR structure

No mandatory split. Phase 1 is boilerplate-heavy but low-risk — no ledger, no
concurrency, no money. Reasonable groupings for review sanity:

- **PR-1** (P1-01 → P1-03): monorepo, Docker, Prisma init. Merges without any
  user-visible surface.
- **PR-2** (P1-04 → P1-09): auth, guards, audit log, error filter, `common/`
  helpers. Backend-only.
- **PR-3** (P1-11 → P1-15): React shell, i18n, PWA, login screen.
- **PR-4** (P1-16): deploy to VPS.

P1-10 (`common/money.ts` and `common/period.ts`) can ride with PR-2. It has no
callers yet, but its unit tests still run — and P3 will lean on `period.ts`
being timezone-correct, so the tests earn their place today.

---

## 2. Migrations

### `20260729000001_init_auth`

The whole auth surface goes in one initial migration. Keeping it as a single
migration is intentional — nothing before it exists to depend on it, and a
migration renamed on merge is a familiar footgun.

Tables:

| Table | Columns of note |
|---|---|
| `user` | `id` UUID PK, `phone` TEXT UNIQUE, `pin_hash` TEXT (argon2), `full_name` TEXT, `is_active` BOOL, `locked_until` TIMESTAMPTZ NULL, `failed_login_count` INT DEFAULT 0, `created_at`, `updated_at` |
| `role` | `id` UUID PK, `code` TEXT UNIQUE (`OWNER`, `EMPLOYEE`, …), `label_fr` TEXT, `label_ar` TEXT |
| `permission` | `id` UUID PK, `code` TEXT UNIQUE (matches the enum in `common/permissions.ts`) |
| `role_permission` | `(role_id, permission_id)` composite PK |
| `user_role` | `(user_id, role_id)` composite PK — v1 is one role per user but the schema does not enforce that (see §8) |
| `audit_log` | `id` UUID PK, `actor_user_id` NULL, `action` TEXT, `entity_type` TEXT NULL, `entity_id` TEXT NULL, `before` JSONB NULL, `after` JSONB NULL, `reason` TEXT NULL, `ip` INET NULL, `created_at` TIMESTAMPTZ DEFAULT `now()` |

Hand-added constraints (SQL — Prisma cannot express these):

- `CHECK (failed_login_count >= 0)` on `user`.
- Index `audit_log(entity_type, entity_id, created_at DESC)` for the audit
  viewer in P6.
- Index `audit_log(actor_user_id, created_at DESC)` for the user-activity
  report in P6.
- `NO DELETE` grant on `audit_log` for the application role — enforced with a
  post-migration `REVOKE DELETE ON audit_log FROM currency_app;` statement.
  If the application role does not exist yet in local dev, guard the statement
  with `DO $$ BEGIN IF EXISTS (…) THEN … END IF; END $$;`.

Regeneration risk: if Prisma is re-run against a modified schema, these raw
statements are silently dropped from the migration file. **Eyeball the file
before commit** (conventions §1 self-review checklist, item 6).

---

## 3. Core services — build first, with tests

### `AuthService`

Numbered contract:

1. `login(phone, pin, ip)` — looks up the user by phone. If none, or `!is_active`,
   or `locked_until > now()`, throw `InvalidCredentialsError` (same message
   regardless — enumeration must not leak from the error). Verify the PIN with
   argon2. On failure, increment `failed_login_count`; if it crosses the
   threshold, set `locked_until = now() + 15 minutes` and reset the counter to
   0. Write an audit row (`action = 'login_failed'`).
2. On success, zero `failed_login_count`, clear `locked_until`, mint a JWT
   with `{ sub: userId, iat, exp }`, and return it to the controller which
   sets the httpOnly SameSite=Lax cookie. Audit `login_succeeded`.
3. `logout(user)` — clear the cookie, audit `logout`. Token invalidation is
   not required in v1 (no server-side sessions; JWT expiry is the ceiling).
4. `resetPin(actor, targetUserId, newPin)` — owner-only; verifies actor has
   `user:reset_pin`; hashes and stores; audits `pin_reset` with `actor_user_id`
   and target `entity_id`. There is no self-service reset flow — clients may
   not have email.

Transaction boundary: `login` is a single `$transaction` covering the failure
counter update, lockout write, and audit row. Otherwise a race between two
failed logins can lose the count that would have triggered lockout.

What this service does NOT do: no session table, no refresh tokens, no
device tracking. If any of these appear in the diff, that's scope creep.

### `PermissionGuard` (`@RequirePermission('sale:create')`)

Fetches the user's permission codes from `user_role → role_permission →
permission`. Caches per-request. If the decorator is absent, the guard fails
closed — return 403. This is asserted by **P1-07**, which introspects the
route table at test time and fails if any controller method has no
`@RequirePermission` and no `@Public`.

Permission codes are enumerated in one file: `common/permissions.ts`. Adding
a new permission means adding a line here and a row in the seed script.
Nothing else. String literals scattered across controllers get rejected in
review.

### `AuditService`

`log(tx, { action, actorId, entityType?, entityId?, before?, after?, reason? })`.
Takes the transaction client so the audit row shares the transaction it
describes — if the write rolls back, so does its audit line. The service is
the only writer of `audit_log`.

### `common/money.ts`

`Decimal` re-exported from `decimal.js` with `roundTo(amount, decimals)` and
a small guard that rejects a `number` input at runtime (`typeof amount ===
'number'`). Yes, the type system already prevents it. The runtime check is
belt-and-braces; the day someone passes `Number(input.value)` at the seam
between HTTP and service is the day it earns its cost.

### `common/period.ts`

`startOfPeriod(date, granularity, tz)`, `endOfPeriod(...)`, `dayOfPeriod(...)`.
Reads the business timezone from the `settings` table — **but that table doesn't
exist yet.** In P1 the timezone is read from an env var (`BUSINESS_TZ`,
default `Africa/Nouakchott`); P2-02 migrates it to the settings row and the
env var becomes a fallback. This is called out in `docs/decisions.md` D-012.

---

## 4. Endpoints

| Method | Path | Auth | Body / result |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | public, rate-limited | `{ phone, pin }` → 204 + Set-Cookie |
| `POST` | `/api/v1/auth/logout` | authenticated | → 204 + Clear-Cookie |
| `GET`  | `/api/v1/auth/me` | authenticated | → `{ id, fullName, roles: [...], permissions: [...] }` |
| `POST` | `/api/v1/users/:id/reset-pin` | `user:reset_pin` | `{ newPin }` → 204 |
| `GET`  | `/api/v1/health` | public | → `{ status: "ok", version, dbUp }` |

`/health` is not gated but does not touch business data — it only pings the
DB. It is what Traefik hits.

Rate limiting: `/auth/login` is limited to 5 attempts per minute per IP
**and** 10 per hour per phone number (separate limiter). Both counters live
in-process — no Redis in v1.

Every non-public route runs through `PermissionGuard`. `/health` and
`/auth/login` are marked `@Public` explicitly; the route-table test in P1-07
treats `@Public` and `@RequirePermission` as the only two acceptable states.

---

## 5. Frontend

Routes (React Router):

```
/login                    LoginPage
/                         DashboardShell (placeholder card grid)
/settings/profile         MyProfilePage (name, language toggle, logout)
/*                        NotFoundPage
```

The dashboard is a placeholder — actual cards land phase by phase. Its job
today is proving the layout shell (bottom nav, RTL flip, safe-area insets)
before anyone reads real numbers off it.

Components:

- `AppShell` — layout with bottom navigation. Icons + labels; labels wrap for
  Arabic. Uses logical properties throughout (`padding-inline`, not `padding-left`).
- `LoginForm` — phone (with country-code prefix segment) + PIN (numeric keypad
  on mobile via `inputMode="numeric"`). Submit disables on click and stays
  disabled until the response returns.
- `LanguageSwitcher` — writes to `localStorage` and reloads to re-issue
  `dir="rtl"`.
- `OfflineBanner` — subscribes to `navigator.onLine`; shows a persistent bar
  when offline. In P1 it is banner-only. Write-blocking arrives with the
  first mutating form (P4).

Cache keys added in this phase: `['auth', 'me']`. Invalidated by `login` and
`logout` mutations.

i18n keys added:

- `auth.phone`, `auth.pin`, `auth.submit`, `auth.wrong_credentials`,
  `auth.locked_out`
- `nav.dashboard`, `nav.profile`, `nav.logout`
- `errors.network`, `errors.unknown`, `errors.session_expired`
- `common.loading`, `common.retry`

Every key exists in `locales/ar.json` and `locales/fr.json` in the same
commit that references it. A key present in one language only fails
`web/test/i18n-parity.test.ts`, added as part of P1-13.

---

## 6. Tests

Priority order. Concurrency tests come first because they are the ones people
skip when the sprint gets tight.

1. **P1-05** Two concurrent failed logins for the same user increment
   `failed_login_count` by 2, not 1. Runs with real Postgres, real
   `$transaction`, no mocks. This is the template for every future
   concurrency test.
2. **P1-07** The route-table introspection test enumerates every controller
   method; any method with neither `@RequirePermission` nor `@Public` fails
   the test with a helpful message naming the missing method.
3. **P1-05** Argon2 verification round-trip: hash a PIN, verify it, verify a
   wrong PIN fails. Guards against a config change quietly downgrading the
   hasher.
4. **P1-06** Sixth failed login within the window triggers lockout;
   `locked_until` is set; subsequent login within the window is refused with
   `AccountLockedError` regardless of PIN correctness; audit rows record all
   attempts.
5. **P1-08** Every audit-worthy action (login, failed login, logout, user
   create, user deactivate, permission change, PIN reset) produces an audit
   row with the actor id, action string, and `before`/`after` populated where
   relevant. Verified by reading `audit_log` directly.
6. **P1-09** A raw `throw new Error('boom')` inside a controller produces a
   500 with body `{ code: "internal", message: "…generic…" }` and no stack
   trace on the wire, but the full stack lands in the server log.
7. **P1-10** `roundTo` is half-up for both positive and negative amounts and
   rejects a `number` input; `startOfPeriod('month', d, 'Africa/Nouakchott')`
   returns 00:00 local time on the 1st (a UTC 23:00 the previous day in
   winter).
8. **P1-12** Global 401 handling: any 401 clears the auth cache and redirects
   to `/login`; verified by mocking the fetch layer.
9. **P1-13** i18n parity test: every key in `ar.json` exists in `fr.json` and
   vice versa. Runs as part of the web unit suite.

No standing invariants added in this phase — there is no ledger yet. INV-1
through INV-9 arrive with the phases that give them targets (P3 lights up
INV-1/4/6/8/9; P4 adds INV-7; P5 adds INV-2/3/5).

---

## 7. Definition of Done — checklist

Copied from `tasks.md` Phase 1, expanded to concrete checks:

- [ ] The URL resolves over HTTPS on the VPS, produces a valid TLS cert from
      Traefik, and the site installs to a phone home screen (verified on at
      least one real Android and one real iOS).
- [ ] `curl -X POST https://.../api/v1/users` without a cookie returns 401,
      and with an authenticated cookie belonging to a user without
      `user:create` returns 403 — **not** an empty 200. Screenshot the curl
      output into the PR.
- [ ] The route-table test in P1-07 passes; adding a new controller method
      without `@RequirePermission` demonstrably fails it locally.
- [ ] After one successful login, one failed login, and one permission change,
      the `audit_log` table contains three rows with populated `actor_user_id`
      and `action` — verified by `SELECT`, not by the UI (which does not
      exist yet).
- [ ] The login page and the profile page have been operated in Arabic on a
      real phone: bottom nav flipped, form controls flipped, text reads
      right-to-left, no clipped content in a 360 px viewport.
- [ ] `npm run ci` (lint, typecheck, unit, integration, i18n parity) is
      green on `main`.
- [ ] The deploy command in `README.md` was run at least once and it worked.
      If not, the README is fiction and gets fixed now.

---

## 8. Explicitly deferred

Named so no one silently adds them:

- **Multi-role per user** — schema supports it, UI in P2-11 assumes one.
  Multi-role UX and permission-conflict resolution are out of scope until
  someone actually asks for it.
- **Password/PIN complexity rules** — v1 uses a minimum length only. Rotation
  and history are not in scope (spec has no requirement).
- **Session revocation on password change** — not applicable (PIN reset is
  admin-triggered; JWT expiry is the only revocation).
- **Email or SMS in the reset flow** — explicitly rejected (`architecture.md`
  §4). Admin PIN reset is the only path.
- **Refresh tokens** — sliding JWT expiry only in v1.
- **Any `settings` table** — arrives in P2-02. `common/period.ts` reads the
  business timezone from an env var until then.
- **Any financial table, ledger, cost movement, or balance** — arrives in P3.
  If a migration file in this phase creates any of these, the phase is not
  done.
- **The `payment_method` lookup** — D-020, arrives in P2-05. Movements
  written before that table exists cannot carry a method, which is fine
  because no financial writes exist in v1.
- **Offline write-blocking** — the banner ships, the blocking arrives with
  the first mutating form (P4). The two are separate deliverables.
- **Dashboard cards with real numbers** — placeholder in P1, real cards in
  P7.
