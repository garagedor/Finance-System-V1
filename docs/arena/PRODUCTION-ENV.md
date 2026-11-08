# 317 LIVE ARENA — production environment

Status: **prepared, not applied.** Nothing here has been set in production. Every
item is for owner review before any production change. No secret values appear in
this file.

The technician API refuses to start in a dangerous configuration: every technician
request runs `techEnvProblems()` (`src/lib/arena/tech/self-check.ts`) through
`readTechConfig()`. Any problem → `503 arena_disabled` + a server log line naming
the problem. The admin side uses the same check for the account verifier; if the
check fails there, every account is *unverified* and approval is blocked (fail
closed, nobody disqualified).

"Deployed" means running on Vercel (`VERCEL=1` or `VERCEL_ENV` set, which includes
Preview deployments).

## Variables

| Variable | Production value / guidance | Secret? |
|---|---|---|
| `ARENA_MONGODB_DB` | Name of the Arena database, e.g. `arena_prod`. Must differ from the CRM database (`MONGODB_DB`, and never `ag`); enforced in `env.ts`. | no |
| `ARENA_MONGODB_URI` | **Required when deployed.** Connection string of the dedicated Arena Atlas user (below). On Vercel (production *and* preview) or with `NODE_ENV=production`, the Arena refuses to run without it, and refuses it when it is the CRM app's own user — there is no fallback to the CRM's write-capable connection (`env.ts` `arenaMongoUri`; technician API → `503 arena_disabled`, Control Center → 503). Only the local dev stack (`ARENA_DEV_STACK=1`, loopback MongoDB, not on Vercel) shares `MONGODB_URI`. | **yes** |
| `ARENA_OWNER_USER_ID` | The owner's CRM `users._id`. Only this account can initialise Arena settings. | no |
| `ARENA_TECH_ENABLED` | **Unset (off) by default.** Set to `1` only at launch, after everything below is in place. | no |
| `ARENA_WB_SUPABASE_URL` | `https://<production WB ref>.supabase.co`. | no |
| `ARENA_WB_DENY_REFS` | Leave unset in production (it only guards dev configurations). | no |
| `ARENA_VERIFIER` | Unset or `wb` (the `arena-verify` Edge Function). **Never `fake-dev`.** | no |
| `ARENA_WB_VERIFIER_SECRET` | Dedicated shared secret for `arena-verify` (≥ 32 chars, random, e.g. `openssl rand -base64 36`). The WB function stores only its SHA-256 (`ARENA_VERIFY_KEY_SHA256`). Rotate both together. | **yes** |
| `ARENA_PASS_PRIVATE_KEY` | Fresh RSA-2048 PKCS#8 key (PEM or base64 of it), generated for production only. | **yes** |
| `ARENA_PASS_TTL_SECONDS` | Unset (= **300**). Values above 300 are refused when deployed. | no |
| `ARENA_TECH_ALLOWED_ORIGINS` | The real app origins only: `capacitor://localhost` (iOS app) and the https web origin of the Weekly Balance app. No `http://`, no localhost/127.0.0.1, no `*` (all refused when deployed). | no |
| `CRON_SECRET` | Already used by the CRM's crons; the Arena freeze safety net runs inside `/api/scanpay/cron-sync` behind it. Must be set (the existing routes only check it *when* set). `/api/arena/health` and `/api/arena/monitor` **require** it (≥ 16 characters; unset = every cron call refused). | **yes** |

### Must NEVER be set in production (refused when deployed)

- `ARENA_DEV_STACK` (any value) — enables the dev-only early freeze.
- `ARENA_VERIFIER=fake-dev`, `ARENA_FAKE_VERIFIER_FILE`.
- `ARENA_WB_VERIFIER_KEY` — the retired service-role RPC key; refused everywhere.
- `NODE_ENV` other than `production`.

## Atlas users (least privilege)

1. **`lbs_arena_app`** (used via `ARENA_MONGODB_URI`)
   - `readWrite` on the Arena database only (`ARENA_MONGODB_DB`; it creates its own indexes).
   - `find` only, on exactly these CRM collections in the CRM database:
     `Job` (job source, live recompute every refresh — an aggregation over the collection: tech, date, status, location, profit fields, hashed contact for duplicate keys; also by-id lookups for late edits),
     `TechNameMapping` (`supabaseUserId`, `supabaseFullName`, `crmTechNames`; read on every technician request),
     `Technician` (`_id`, `location`),
     `users` (`name` only — the Control Center overview, `admin/overview`; without it that one admin panel fails).
     Nothing else: the Arena does not read `Location`, `Provider` or any finance collection.
   - Implement as a custom role, e.g.
     `{ role: "arenaApp", privileges: [ {resource:{db:"<arena db>", collection:""}, actions:[readWrite actions]}, {resource:{db:"ag", collection:"Job"}, actions:["find"]}, {resource:{db:"ag", collection:"TechNameMapping"}, actions:["find"]}, {resource:{db:"ag", collection:"Technician"}, actions:["find"]}, {resource:{db:"ag", collection:"users"}, actions:["find"]} ] }`.
   - With this user the Arena cannot write CRM data even by mistake.
2. The CRM app user (`lbs_crm_app`) needs **no** Arena change and no rights on the
   Arena database: when deployed, the Arena never uses it.

## Live updates: monitoring and keep-warm

The live standings are recomputed on read: when a technician request (or the
Control Center) finds the week's live snapshot older than `rules.display.refreshSeconds`,
one caller recomputes the whole week from the CRM (single-flight lease) and the
rest are served the cached snapshot. A failed recompute keeps serving the last
snapshot (the app then shows "Reconnecting — data may be out of date") and is
recorded in `arena_live_health`.

- `GET /api/arena/health` — read-only, never recomputes. Auth: `x-cron-secret: <CRON_SECRET>`
  (or `Authorization: Bearer <CRON_SECRET>`), **or** a CRM session with `arena:console:view`.
  Reports the live snapshot age, last compute time and duration, last error and
  consecutive failures; `healthy=false` when the live snapshot is older than
  3 × `refreshSeconds` or the last recompute failed. `?strict=1` answers 503 when unhealthy.
- `GET /api/arena/monitor` — cron secret only. Freezes a finished week if due and
  refreshes the live snapshot when it is stale, so freshness and stall detection do
  not depend on technicians being connected. Answers the health report (503 when unhealthy).

Both are exempt from the portal-session middleware by exact path and authenticate
in-route (fail closed).

**Proposed Vercel cron (NOT applied — `vercel.json` is unchanged on this branch):**

```json
{ "path": "/api/arena/monitor", "schedule": "* * * * *" }
```

Vercel sends `Authorization: Bearer $CRON_SECRET` on cron calls. **Per-minute crons need
the Vercel Pro plan** (Hobby allows one run a day) — owner/infra decision. Without the
cron the Arena still works; the snapshot is simply refreshed only while someone has
the app open, and the daily `/api/scanpay/cron-sync` freeze safety net is unchanged.
An external uptime monitor can call `/api/arena/health?strict=1` with the
`x-cron-secret` header instead of (or as well as) the cron.

Load per refresh: one aggregation over `Job` (the week + Most Improved baseline
weeks), `TechNameMapping` + `Technician` reads, and the Weekly Balance account check
(reused for 2 minutes in the live phase; freeze/review/approval always re-check).
Measured on a synthetic 40-technician week (1,000 jobs/week, 5,000 in the window,
35,000 in the collection) on a local MongoDB: ~320 ms per recompute; ~1.4 s when the
account answers are re-checked (150 ms per verifier call, 6 in parallel).

## Weekly Balance side (production, after staging sign-off)

1. Apply `supabase/migrations/20261030120000_arena_verify_account.sql` (branch
   `feature/arena-verify`). Rollback: `supabase/ops/arena_verify_rollback.sql`.
2. Deploy the `arena-verify` Edge Function with `verify_jwt = false` (config.toml).
3. Set the function secret `ARENA_VERIFY_KEY_SHA256` = hex SHA-256 of
   `ARENA_WB_VERIFIER_SECRET`, using `supabase secrets set --env-file <file>` (never
   on the command line).
4. Separate known WB defect (not Arena): the admin screen's "Active" switch sends
   only `is_active`, which the lifecycle trigger reverts for APPROVED users — so the
   switch does not deactivate anyone. Deactivation works through `status`. Fix in
   the WB admin screen before relying on it operationally.

## Launch checklist

1. Atlas user + `ARENA_MONGODB_URI`, `ARENA_MONGODB_DB`, `ARENA_OWNER_USER_ID`.
2. WB function + secret (above); `ARENA_WB_SUPABASE_URL`, `ARENA_WB_VERIFIER_SECRET`.
3. `ARENA_PASS_PRIVATE_KEY` (fresh), `ARENA_TECH_ALLOWED_ORIGINS` (real origins).
4. Confirm `CRON_SECRET` is set.
5. Deploy with `ARENA_TECH_ENABLED` unset; check the server log has no
   "unsafe technician configuration" line (a request to `/api/arena/auth/exchange`
   must answer `503 arena_disabled` while off).
6. Owner sets `ARENA_TECH_ENABLED=1` at launch.
