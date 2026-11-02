# 317 LIVE ARENA — Technician API (server side)

Status: **development only** (branch `feature/live-arena`). Production has none of
the `ARENA_TECH_*` variables, so the technician API answers `503 arena_disabled`
there. Contract: `src/lib/arena/tech-api-contract.ts` (version 1).

## Endpoints

| Method | Path | Auth | Answer |
|---|---|---|---|
| POST | `/api/arena/auth/exchange` | `Authorization: Bearer <Weekly Balance access token>` | `ExchangeResponse` |
| GET | `/api/arena/tech/me` | `Authorization: Bearer <Arena pass>` | `MeResponse` |
| GET | `/api/arena/tech/leaderboard?view=national\|eligible&week=YYYY-MM-DD` | pass | `LeaderboardResponse` |
| GET | `/api/arena/tech/history?limit=1..52` (default 12) | pass | `HistoryResponse` (approved weeks only) |
| GET | `/api/arena/tech/events?since=<cursor>` | pass | `EventsResponse` |
| OPTIONS | all of the above | none | CORS preflight |

Errors: `{ error, code }` with `code` from the contract.
`401 invalid_token` (exchange) / `401 unauthorized` (no or bad pass),
`403 account_inactive`, `403 not_a_competitor`, `403 forbidden` (origin not allowed),
`404 not_found`, `400 bad_request`, `429 rate_limited`, `503 arena_disabled`
(switch off, misconfiguration, or the account verifier unreachable — fail closed).

Behaviour notes for the app:
- `events` without `since` returns the current cursor and, at most, **one** event: the
  caller's own `result_approved` from the most recent approval, if it was approved in
  the last 7 days and the caller won something (prize or Most Improved). Never rank,
  qualification or phase history. This is what makes "celebration on the next app
  open" work after the next week has started (when `/me.award` already describes the
  new week). The app shows it once per week per device (dismissal stored locally).
  Poll with the returned cursor every `rules.refreshSeconds`; the replayed event is
  not delivered again on that cursor.
- `result_approved` is written only by the owner's approval action. Celebrate only on it.
- `leaderboard?week=` works for any started week (live, frozen, in review, approved);
  a draft/scheduled week is `404`.
- `/me.standing` is `null` when the technician is not taking part this week;
  `rank: null` means taking part but no jobs yet.

## Contract change (additive, version not bumped)

`MeResponse.notices: { kind: "rules_amended" | "suspended" | "resumed"; message; at }[]`
— participant notices required by spec Addendum B.5 (owner mid-week rule change /
suspension). Newest first, `[]` when none. A suspended week is reported as phase
`live` (before Sunday end) with a `suspended` notice; no new phase value was added.
The copy in the-convert (`src/arena/contract.ts`) must receive the same field.

## Auth flow

1. The app signs in to Weekly Balance as today (tech-login / Supabase Auth) and holds
   a Supabase access token.
2. `POST /api/arena/auth/exchange` with that token. The CRM:
   - verifies it against the project's JWKS: **ES256 only**, issuer
     `https://<ref>.supabase.co/auth/v1`, audience `authenticated`, ≤60 s clock skew,
     `sub` must be a UUID, `role` must be `authenticated`, anonymous sign-ins refused.
     HS256 (incl. "HS256 keyed with the public key"), `alg: none`, other projects,
     anon/service keys are all `invalid_token`;
   - asks the Weekly Balance verifier whether the account is **active + approved**
     with role `technician` or `area_manager` (never trusting anything the client sends);
   - maps the Supabase user id to a competitor through `TechNameMapping.supabaseUserId`
     (competitor id = that user id) and checks the current competition's participant
     rules (excluded ids / locations / "only" list);
   - issues an **Arena pass**: RS256 JWT, `iss lbs-crm-arena`, `aud arena`,
     `sub` = competitor id, `jti`, **5 minutes** (no other claims).
3. The app calls the `tech/*` endpoints with `Authorization: Bearer <pass>` and
   re-exchanges when it expires (or on any 401).

**Every technician request re-checks** (pass validity alone is never enough):
master switch on → pass signature/iss/aud/alg/expiry → on the pilot allowlist → Weekly Balance account still
active + approved (verifier, **no cache**) → mapping still points to that user and
the person is not excluded. A deactivation, un-approval, unmapping or exclusion is
refused on the very next call even with an unexpired pass (tested in unit tests and
in the e2e script). The verifier costs one small RPC per request; no cache was added
because the owner asked for immediate effect and request volume is low (one poll per
technician per `refreshSeconds`). If load ever requires it, a ≤5 s cache is the most
that should be considered.

Accepted credentials: **only** the pass in the `Authorization` header. Cookies are
never read by these routes (a CRM `session` cookie gives 401), a Supabase token
gives 401, and the pass opens nothing else (admin and CRM routes still require the
CRM session in middleware — the pass is not a session cookie).

## Middleware

`src/middleware.ts` exempts exactly five paths (a `Set`, not a prefix):
`/api/arena/auth/exchange`, `/api/arena/tech/{me,leaderboard,history,events}`.
`src/lib/arena/arena-tech-routes.test.ts` calls the real middleware for every
`/api` route in the repo plus look-alike paths (`/api/arena/tech/me/x`,
`/api/arena/techx/me`, `/api/arena/admin/*`, …) and asserts 401 without a session.

## Lifecycle behind the data (`src/lib/arena/lifecycle.ts`)

- **Live:** reads recompute the live snapshot when it is older than
  `rules.display.refreshSeconds` or was computed under a different rule version (so an
  owner amendment shows on the next read). One caller recomputes (compare-and-swap
  claim in `arena_claim`); others get the cached copy. Events are derived by diffing
  successive snapshots per competitor.
- **Freeze:** the first read after Monday 00:00 (competition timezone, DST-aware, i.e.
  "end of Sunday") freezes the week (`provisional`, insert-only snapshot). Admins can
  also press *Freeze week* — refused before Sunday ends.
- **Review:** an admin opens review (`in_review`), which re-checks the CRM data (late
  Sunday entries); *Re-check* repeats it. The Control Center shows the diff against
  the freeze and any blockers (unresolved suspected duplicates that could move prizes).
- **Approval:** OWNER ONLY (the settings owner, also on the approver list), only in
  review, not before the review window (Tuesday 12:00 in the competition timezone by
  default), only for the exact snapshot the owner looked at, with rules/budget
  re-validated. Writes one immutable, content-hashed `arena_result` (`_id` =
  competition id; a second approval fails), an `arena_approval` log row, audit, and the
  `result_approved` events. **No payouts, ledger entries or CRM writes.**
- **Dev only — "Freeze now (dev)":** owner-only action that freezes the running week
  early so the whole flow can be demonstrated today. Refused unless `ARENA_DEV_STACK=1`.
  A week frozen this way is marked `devEarlyClose` and may be approved before Tuesday
  12:00 — again only while `ARENA_DEV_STACK=1`. The real Sunday-end freeze and Tuesday
  review rule are unchanged everywhere else.

Admin API added: `GET /api/arena/admin/competitions/[id]/results`,
`POST …/[id]/approve {snapshotId, note?}`, and actions `freeze`, `freeze_now_dev`,
`open_review`, `reconcile` on `POST …/[id]/action`. Control Center: Weeks → *Results* /
*Review* opens the panel with those buttons.

## Environment

| Variable | Meaning |
|---|---|
| `ARENA_TECH_ENABLED` | `1` turns the technician API on. Default **off** → `503 arena_disabled`. |
| `ARENA_WB_SUPABASE_URL` | `https://<ref>.supabase.co` of the Weekly Balance project (issuer and JWKS derive from it). |
| `ARENA_WB_DENY_REFS` | Optional comma list of refs that must never be used. |
| `ARENA_PASS_PRIVATE_KEY` | RSA private key, PKCS#8 PEM or base64 of the PEM. Public key is derived. |
| `ARENA_PASS_TTL_SECONDS` | Pass lifetime, default **300**, allowed 60–900. |
| `ARENA_TECH_ALLOWED_ORIGINS` | Comma list for CORS (dev: `http://127.0.0.1:5173,http://localhost:5173,capacitor://localhost`). A request with any other `Origin` is refused. Credentials are never allowed. |
| `ARENA_VERIFIER` | `wb` (default: the Weekly Balance `arena-verify` Edge Function, see VERIFIER.md) or `fake-dev`. |
| `ARENA_WB_VERIFIER_SECRET` | Dedicated secret for `arena-verify` (≥ 32 chars). Never the service-role key. |
| `ARENA_FAKE_VERIFIER_FILE` | JSON `{accounts: {<uuid>: {active, approved, role}}}` for `fake-dev`; re-read on every call. |
| `ARENA_DEV_STACK` | `1` only on the local dev stack. Enables the dev-only freeze, and allows `fake-dev` under `NODE_ENV=production`. |

Guards:
- In a dev configuration (`NODE_ENV≠production` or `ARENA_DEV_STACK=1`) the
  **production Weekly Balance project is refused**: pinned by the sha256 of its ref in
  `src/lib/arena/tech/config.ts` (the ref itself is not committed) plus `ARENA_WB_DENY_REFS`.
- `ARENA_VERIFIER=fake-dev` is refused when `NODE_ENV=production` unless `ARENA_DEV_STACK=1`.
- Any configuration error disables the API (`503`) rather than degrading it.

## Local dev stack

Files in `~/arena-dev/` (none committed): `arena-dev.env` (600), `keys/arena-pass.pem`
(600), `tech-creds.json` (600, staging test logins), `fake-verifier.json` (600).

1. `node ~/arena-dev/seed.cjs` (base synthetic CRM, local Mongo only).
2. `node ~/arena-dev/staging-techs.mjs` — four synthetic **staging** technicians via
   the real tech-signup + management approval: Alpha, Bravo (approved, mapped),
   Charlie (left **pending**, mapped), Delta (approved, **unmapped**).
3. `cd ~/lbs-arena && env $(grep -v '^#' ~/arena-dev/arena-dev.env | xargs) ARENA_DEV_STACK=1 node --import ./scripts/test-register.mjs ~/arena-dev/seed-tech.mjs`
   — maps Alpha→Marcus, Bravo→Ava, Charlie→Jordan in the local CRM, writes
   `fake-verifier.json` from the staging accounts' real state, and builds 6 approved
   weeks (2026-09-07 … 10-12), a frozen week (10-19) and the live week (10-26)
   through the real lifecycle code.
4. Build + start: `npx next build --webpack`, then
   `env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production $(grep -v '^#' ~/arena-dev/arena-dev.env | xargs) npx next start -p 3999 -H 127.0.0.1`.
5. `node scripts/arena/tech-e2e.mjs` (read-only, 38 checks) or `--acceptance`
   (+ amend rules → dev freeze → review → owner approval → celebration event; re-run
   step 3 afterwards to restore the live week).

The dev stack uses the REAL verifier (`ARENA_VERIFIER=wb`) against the staging
`arena-verify` function (docs/arena/VERIFIER.md). All 15 demo competitors are real
staging accounts (Charlie stays pending on purpose). Logins are real staging logins;
there is no test-token mode. Production configuration: docs/arena/PRODUCTION-ENV.md.

## Data minimization

Response objects are built field by field in `src/lib/arena/tech/views.ts` — nothing
is spread from internal records. Tests walk every key of every response and fail on any
field not in the contract, on job ids, CRM short names, profit sums, phones, addresses,
invoices, and Supabase identifiers. Other competitors appear only as leaderboard rows
(display name, location, rank, score, gates met, prize; metrics only if the rules show
ineligible metrics or the row is eligible). History shows only winners and the caller.

## Security properties (summary)

- Two different trust domains: Weekly Balance proves *who*; the CRM decides *whether
  they may see the Arena*, on every request.
- Algorithms pinned on both tokens (ES256 in, RS256 out); issuer + audience pinned.
- Short pass (5 min) + immediate revocation through per-request re-verification.
- No cookies, no CORS credentials, allow-listed origins, `Cache-Control: no-store`.
- Exact-path middleware exemption; every other `/api` route still needs the CRM session
  (tested across the whole route tree).
- Fail closed: switch off, bad config, verifier errors → `503`; unknown account → `403`.
- Rate limit on the exchange: 60/min per IP and 10/min per user+IP, counted in the
  Arena database (shared across serverless instances, TTL-cleaned).
- Startup self-check refuses dangerous configurations (tech/self-check.ts).
- Account eligibility (prizes) uses the same verifier: fresh at freeze/review/approval,
  last known while live; unavailable = unresolved → approval blocked.

## What production still needs

See docs/arena/PRODUCTION-ENV.md (variables, forbidden settings, Atlas users, WB
function rollout, launch checklist). Remaining open items beyond it:
1. Key rotation story for the pass key (add `kid` + a second verification key).
2. Event-feed retention (old `arena_tech_event` rows are never pruned).
3. Owner sign-off on the contract addition (`notices`) and on the dev-only actions
   staying dev-only.

## Pilot allowlist (technician access gate)

`src/lib/arena/tech/allowlist.ts`, collection `arena_tech_access` (Arena database).
**Default deny:** with `ARENA_TECH_ENABLED=1`, only competitor ids (Weekly Balance user
ids, lowercase) with `allowed: true` get through the exchange and every `tech/*` request.
Anyone else gets **exactly** the switch-off answer (`503 arena_disabled`, same body and
headers). The allowlist is checked right after the token/pass signature and BEFORE the
verifier, the mapping and the per-user rate limit, so someone outside the pilot never
sees `account_inactive`, `not_a_competitor` or a per-user `429`, and the Weekly Balance
verifier is not called for them. No cache: a revoke refuses the very next request even
with an unexpired pass. A lookup error is "not allowed" (fail closed).

Still observable to anyone (unchanged): `401` for a missing/invalid token or pass, the
per-IP `429` (60/min) and the CORS origin check. The real WB app always sends a valid
token, so a non-allowlisted technician sees only "Arena is coming soon".

Management (`/api/arena/admin/tech-access`, CRM session):
- `GET` (`arena:console:view`): current rows, `techApiEnabled`, `allowedCount`, last 200 access audit rows.
- `POST { competitorId, allowed: true|false, reason }` (`arena:rules:edit`): grant / revoke one.
- `POST { action: "revoke_all", reason }`: emergency, revoke everyone.
- Changes are **owner-only** inside the store (settings `ownerUserId`), need a reason, and are
  audited in `arena_audit` (`tech_access.grant|revoke|revoke_all`, `target tech_access:<id>`,
  `by`, `at`, `reason`, `before`, `after`). A grant must name an id with a `TechNameMapping`.

The allowlist controls ACCESS only. Who is scored, ranked and prize-eligible stays the
competition's participant rules (`rules.participants`).
