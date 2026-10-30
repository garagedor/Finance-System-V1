-- SUPERSEDED (2026-10-30): implemented on the Weekly Balance branch
-- feature/arena-verify as supabase/migrations/20261030120000_arena_verify_account.sql
-- (pending-aware semantics) + the arena-verify Edge Function. See VERIFIER.md.
-- Kept only as the original proposal.
-- 317 LIVE ARENA — Weekly Balance account verifier (owner Decision 4, "Option B").
--
-- PROPOSAL ONLY. Not applied anywhere. To be added on a Weekly Balance branch,
-- reviewed, applied to STAGING first, and only then to production.
--
-- The CRM calls this with a server-only key on the technician exchange AND on
-- every technician request (no caching), so deactivating or un-approving an
-- account takes effect on the very next Arena call:
--   POST https://<ref>.supabase.co/rest/v1/rpc/arena_verify_account
--   body {"_user_id": "<uuid>"}
--
-- Properties:
--   * read-only (STABLE), SECURITY DEFINER with an empty search_path (every
--     object fully qualified), so it does not depend on RLS or on the caller;
--   * EXECUTE granted to service_role ONLY — never anon/authenticated, so a
--     technician cannot probe other accounts;
--   * returns NOTHING but three fields (no name, phone, email, area, commission);
--   * an unknown id returns zero rows (the CRM treats that as "not allowed").
--
-- Semantics (match public.users as of 2026-10-30 on staging):
--   active   = account may sign in and is not archived/deactivated/rejected
--   approved = management approved it (status APPROVED, not pending)
--   role     = app_role as text; the CRM accepts only technician / area_manager.

create or replace function public.arena_verify_account(_user_id uuid)
returns table (active boolean, approved boolean, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (u.is_active and u.can_login and u.archived_at is null
       and u.status not in ('DEACTIVATED', 'REJECTED'))          as active,
    (u.status = 'APPROVED' and not u.pending_approval)           as approved,
    u.role::text                                                 as role
  from public.users as u
  where u.id = _user_id
$$;

revoke all on function public.arena_verify_account(uuid) from public;
revoke all on function public.arena_verify_account(uuid) from anon, authenticated;
grant execute on function public.arena_verify_account(uuid) to service_role;

comment on function public.arena_verify_account(uuid) is
  '317 Live Arena: {active, approved, role} for one account. service_role only. Read-only.';

-- Rollback:
--   drop function if exists public.arena_verify_account(uuid);

-- Note on the key: PostgREST runs this as service_role when called with the
-- service-role key. A narrower credential (a dedicated Postgres role with
-- EXECUTE on this one function, exposed through its own JWT) would be better
-- for production; see docs/arena/TECH-API.md "What production still needs".
