# Account verifier — privilege model and staging record

## What it answers
`{active, approved, role}` for ONE Weekly Balance account id — nothing else.
Implemented on Weekly Balance branch `feature/arena-verify` (the-convert):

- `public.arena_verify_account(uuid)` — SQL, `STABLE`, `SECURITY DEFINER`,
  `search_path = ''`, EXECUTE for `service_role` only (revoked from PUBLIC, anon,
  authenticated). Semantics follow `sync_user_lifecycle_fields`: PENDING_APPROVAL →
  active, not approved ("pending"); DEACTIVATED / REJECTED / archived → not active.
- Edge Function `arena-verify` (`verify_jwt = false`) — the only caller. Accepts
  `POST {user_id}` with header `x-arena-verify-key`; compares SHA-256 of it with the
  function secret `ARENA_VERIFY_KEY_SHA256` in constant time; returns the three
  fields built field by field (or `{account: null}`); 401/400/405/503 otherwise.
- Arena server: `WbEdgeVerifier` (`ARENA_VERIFIER=wb`, `ARENA_WB_VERIFIER_SECRET`),
  4 s timeout, no redirects, every failure = unavailable (fail closed).

## Why not a dedicated Postgres login role
Preferred on paper, measured on staging, rejected: every login role is a member of
PUBLIC, and on this Supabase project PUBLIC has USAGE on schema `net` and EXECUTE
on all `pg_net` functions plus full rights on `net.http_request_queue` /
`net._http_response`. A "zero-grant" login role could therefore make the database
send HTTP requests and read queued requests — including the Authorization header
the hourly `open-weekly-reports` cron job sends through pg_net. It would also get
the 26 PUBLIC-executable `public` functions (19 SECURITY DEFINER). Revoking
PUBLIC's grants on Supabase-managed schemas is out of scope here (and a platform
change for production). PostgREST with a custom-role JWT was the next option, but
it needs the project JWT secret to mint a long-lived token whose revocation means
rotating the project's JWT secret. The Edge Function + dedicated secret is the
narrowest credential: it can do exactly one thing, is rotated independently, and
the Arena server never holds the service-role key or a database login.

## Applied to STAGING (2026-10-30) — and only there
1. SQL: `supabase/migrations/20261030120000_arena_verify_account.sql` executed with
   psql (`wb-staging.sh -1 -f …`). Not recorded in `supabase_migrations` (manual).
2. Function secret `ARENA_VERIFY_KEY_SHA256` set via `sb.sh secrets set --env-file`
   (temp file deleted). The plaintext secret lives only in `~/arena-dev/arena-dev.env`
   (mode 600) as `ARENA_WB_VERIFIER_SECRET`.
3. Edge Function `arena-verify` deployed: `sb.sh functions deploy arena-verify --no-verify-jwt --use-api`.
4. Test data: 12 additional approved synthetic technicians (`Arena Demo <Name>`,
   phones 312-555-0751…0762) created through the real tech-signup + manager
   approval (`~/arena-dev/staging-techs.mjs`), so every dev-demo competitor is a real
   staging account. Bravo is deactivated/re-activated by the e2e via a staging
   manager's own session (`status`), and ends APPROVED.

Nothing else in the staging schema was changed.

### Remove from staging
```bash
cd ~/the-convert-wt-verify
~/convert-migration/staging/sb.sh functions delete arena-verify
~/convert-migration/staging/sb.sh secrets unset ARENA_VERIFY_KEY_SHA256
/tmp/claude-1000/…/scratchpad/wb-staging.sh -f supabase/ops/arena_verify_rollback.sql
```
(and set `ARENA_VERIFIER=fake-dev` in `~/arena-dev/arena-dev.env` to go back to the
file verifier.) The synthetic staging technicians can stay; they are ordinary
approved test accounts.
