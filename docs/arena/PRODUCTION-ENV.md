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
| `ARENA_MONGODB_URI` | *Recommended.* Connection string of the dedicated Arena Atlas user (below). When unset the CRM app connection (`MONGODB_URI`) is used. | **yes** |
| `ARENA_OWNER_USER_ID` | The owner's CRM `users._id`. Only this account can initialise Arena settings. | no |
| `ARENA_TECH_ENABLED` | **Unset (off) by default.** Set to `1` only at launch, after everything below is in place. | no |
| `ARENA_WB_SUPABASE_URL` | `https://<production WB ref>.supabase.co`. | no |
| `ARENA_WB_DENY_REFS` | Leave unset in production (it only guards dev configurations). | no |
| `ARENA_VERIFIER` | Unset or `wb` (the `arena-verify` Edge Function). **Never `fake-dev`.** | no |
| `ARENA_WB_VERIFIER_SECRET` | Dedicated shared secret for `arena-verify` (≥ 32 chars, random, e.g. `openssl rand -base64 36`). The WB function stores only its SHA-256 (`ARENA_VERIFY_KEY_SHA256`). Rotate both together. | **yes** |
| `ARENA_PASS_PRIVATE_KEY` | Fresh RSA-2048 PKCS#8 key (PEM or base64 of it), generated for production only. | **yes** |
| `ARENA_PASS_TTL_SECONDS` | Unset (= **300**). Values above 300 are refused when deployed. | no |
| `ARENA_TECH_ALLOWED_ORIGINS` | The real app origins only: `capacitor://localhost` (iOS app) and the https web origin of the Weekly Balance app. No `http://`, no localhost/127.0.0.1, no `*` (all refused when deployed). | no |
| `CRON_SECRET` | Already used by the CRM's crons; the Arena freeze safety net runs inside `/api/scanpay/cron-sync` behind it. Must be set (the existing routes only check it *when* set). | **yes** |

### Must NEVER be set in production (refused when deployed)

- `ARENA_DEV_STACK` (any value) — enables the dev-only early freeze.
- `ARENA_VERIFIER=fake-dev`, `ARENA_FAKE_VERIFIER_FILE`.
- `ARENA_WB_VERIFIER_KEY` — the retired service-role RPC key; refused everywhere.
- `NODE_ENV` other than `production`.

## Atlas users (least privilege)

1. **`lbs_arena_app`** (used via `ARENA_MONGODB_URI`)
   - `readWrite` on the Arena database only (`ARENA_MONGODB_DB`; it creates its own indexes).
   - `find` only, on exactly these CRM collections in the CRM database:
     `Job` (job source: tech, date, status, location, profit fields, hashed contact for duplicate keys),
     `TechNameMapping` (`supabaseUserId`, `supabaseFullName`, `crmTechNames`),
     `Technician` (`_id`, `location`).
   - Implement as a custom role, e.g.
     `{ role: "arenaApp", privileges: [ {resource:{db:"<arena db>", collection:""}, actions:[readWrite actions]}, {resource:{db:"ag", collection:"Job"}, actions:["find"]}, {resource:{db:"ag", collection:"TechNameMapping"}, actions:["find"]}, {resource:{db:"ag", collection:"Technician"}, actions:["find"]} ] }`.
   - With this user the Arena cannot write CRM data even by mistake.
2. The CRM app user (`lbs_crm_app`) needs **no** Arena change. Until
   `ARENA_MONGODB_URI` is set, Arena collections are written through it; that is
   the only reason it would need rights on the Arena database.

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
