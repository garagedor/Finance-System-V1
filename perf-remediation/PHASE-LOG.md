# Performance Remediation — Phase Log

Running record of each phase: what changed, how it was validated, measured deltas.
All work on `wip/transfer`, local only. Restore point: tag `pre-perf-remediation-20260730-0423`.

---

## Phase 0 — Baseline & protection ✅
- Restore point: branch `backup/pre-perf-20260730-0423` + tag at commit `b950e38`.
- Parity harness built: `scripts/perf/capture.mjs` (mints a local admin session via the
  dev JWT secret, snapshots 13 financial endpoints) + `scripts/perf/parity.mjs` (deep,
  **order-insensitive** diff — set/value equality, catches any value change).
- Baseline captured to `perf-remediation/baseline/` (git-ignored — real financials, public repo).
- DB profilers: `scripts/db-profile.mjs`, `scripts/db-explain.mjs`.
- Inventory: 28 `new MongoClient` sites (credential hardcoded in 27 files); `Job` = 47,971
  docs / 24.8 MB / only `_id` index.
- **Data-quality note found:** `home-stats` returns `locationStats`/`techStats` in
  non-deterministic order (no stable `$sort`). Values are correct; only array order floats.
  Proven pre-existing (baseline vs baseline2 both differ). Parity harness made order-insensitive.

## Phase 1 — Centralize MongoDB connections ✅
**Change:** one shared `globalThis`-cached client in `src/lib/mongo.ts`
(`getMongoClient` / `getMongoDb` / `mongoHealth`), serverless pool (`maxPoolSize` 10,
env-overridable), transient-error retry. Routed all 27 per-request sites through it via
`scripts/perf/codemod-mongo.mjs`; unified `finance-db.ts` to delegate (single pool for the
whole app); removed 4 redundant local `getMongoClient` wrappers in `verify/*`.
Credential now lives in ONE place instead of 27 (full rotation is a separate approved cleanup).

**Validation**
- `tsc --noEmit`: only the 2 pre-existing errors (crud-helper, reconcile/match); none new.
- Production build: **green** (`Compiled successfully`, BUILD_EXIT=0).
- **Financial parity: 13/13 endpoints identical** vs baseline.
- **Connection reuse:** 30 parallel `/api/jobs` requests → Atlas `connections.current`
  126 → 127 (**Δ +1**, pool cap 10). Old code would have opened dozens.
- **Warm timings (dev), total 16,503ms → 15,246ms (−8%):**
  payment-method −29% · report-penalty −31% · report-provider −26% · balance-report-tech −23%
  · disputes −24% · jobs −26%. Query-bound endpoints (home-stats) unchanged — that's Phase 2.
  The larger, unmeasured win is on Vercel cold/serverless: no per-request TLS+SCRAM handshake.

**Files:** new `src/lib/mongo.ts`; modified `src/lib/finance-db.ts` + 30 route/store files
(connection wiring only — no business logic touched).

## Phase 2 — Remove over-fetching ◐ (in progress)
**home-stats (7.8s, worst endpoint) — attempted, reverted, DATA-QUALITY FINDING:**
Tried replacing the correlated per-document Provider `$lookup` (scans all 113 providers
per job) with two hash-join lookups. **Parity FAILED (27 diffs)** and the harness caught a
real bug in the *current* code:
- **5 Job docs have a blank/missing `provider`**, and the `$or [_id==p, name==p]` matches
  **all 113 providers** for each → `$unwind` multiplies each of those 5 jobs into 113 rows.
- Effect: the home dashboard **over-counts** — those 5 jobs are counted 113× in
  `jobsByLocation` / `techStats` / `locationStats` (~560 phantom rows), inflating counts and
  skewing `avgTicket` / `closedPct` denominators. (Confirmed: 30,339 jobs match 1 provider,
  457 match 0, **5 match 113**.)
- The rewrite *corrected* this (de-duplicated) — which is why numbers changed. Per the
  financial-parity mandate, **reverted to preserve exact current output.** home-stats is now
  byte-identical to baseline again.
- **RESOLVED — owner approved the correction (2026-07-30).** Applied the two-hash-lookup
  rewrite. Verified the change is surgical: **only `count` / `avgTicket` / `closedPct` moved**;
  no revenue/profit figure changed (the 5 blank-provider jobs weren't in the money facets).
  Total `jobsByLocation` count **31,360 → 30,800** (−560 = 5 jobs × 112 phantom rows removed).
  Baseline snapshot re-blessed to the corrected numbers so later phases parity-check against
  the correct values. Endpoint also modestly faster (7,964 → ~6,775ms); its big win still
  comes from the output-neutral date-index path (Phases 4+6).
- Verify script: `scripts/perf/dq-provider-dup.mjs`.

**DATA-QUALITY EXCEPTION (for final report):** 5 `Job` docs have a blank/missing `provider`.
Not deleted or altered — flagged here for review. They caused the home-stats inflation above.

## Phase 4 — Additive Job.date normalization ✅ (field live; reads not yet switched)
Added `jobDateNormalized` (BSON Date) via `scripts/perf/migrations/backfill-jobdate.mjs`,
computed with the SAME `$dateFromString` the endpoints use (so value == current query-time parse).
- Inventory (read-only first): 47,971 Job docs — 42,395 clean ISO `YYYY-MM-DD`, 5,576
  missing/empty, ~4 empty strings, **0 ambiguous**, 0 unparseable.
- Sample-tested 100 docs (field added, legacy `date` unchanged), then full batched backfill:
  **42,395 written, 0 exceptions, 0 mismatches** (field == parse(date) everywhere).
- Legacy `date` string **untouched** (still string in all 42,399). Reversible via `--rollback` ($unset).
- Missing-date docs left without the field (flagged, not fabricated). Exceptions log:
  `perf-remediation/migrations/jobdate-exceptions.json` (empty — none).
- **API note:** `/api/jobs` returns raw Job docs, so it now includes `jobDateNormalized`
  (additive, non-breaking; all other values identical). Baseline re-blessed. No other endpoint's
  shape changed.
- **NOT YET DONE (next unit):** new Job writes must populate `jobDateNormalized`, and endpoint
  date-`$match`es must switch from `$dateFromString $expr` to `{ jobDateNormalized: {$gte,$lte} }`
  to actually use the index. That read-switch is output-neutral (same value) and will be
  parity-verified per endpoint. Gated on write-path maintenance first (correctness).

## Phase 6 — Measured index strategy ✅ (additive, no drops)
`scripts/perf/migrations/create-indexes.mjs`. Job indexes 1 → 5:
- `jobDateNormalized_-1`, `tech_1_jobDateNormalized_-1`, `status_1_jobDateNormalized_-1`,
  `location_1_jobDateNormalized_-1`.
- **Evidence:** year-range query `COLLSCAN examined=47,971 → IXSCAN examined=30,801` (only
  matching docs). Narrow ranges (a week/month dashboard) benefit far more. Total index size
  **3.97 MB** (collection 24.8 MB) — negligible write overhead. No existing index dropped.
- Indexes are inert until Phase 2 read-switch lands (existing `$dateFromString` queries can't
  use them). Parity confirmed unchanged after creation.

## Phase 4/2 — Write-path maintenance + read-switch to indexed date ✅ (partial)
**Write-path:** `jobs/route.ts` is the ONLY Job writer (import writes finance_* only).
Added `normalizeJobDate()` + populate `jobDateNormalized` on POST (create) and PUT (when
`date` is edited). Verified the JS helper reproduces the backfilled value **500/500** on real
docs. Added `jobDateNormalized?: Date` to the `JobRow` type.

**Read-switch (output-neutral, index-backed):**
- `home-stats` + `stats`: date-range `$match` switched from `$dateFromString $expr` (always
  COLLSCAN 47,971) to `{ jobDateNormalized: {$gte,$lte} }` (IXSCAN). Parity identical.
- Added `{ date: 1 }` string index → `finance` + `balance-report` (which compare the ISO
  `date` string directly) become index-backed with **zero code change**.
- **Proof (1-week range):** old always COLLSCAN 47,971; new IXSCAN examines **1,492 (2–3ms)**
  — ~32× fewer docs examined. Full-year ranges benefit less (they match most docs); the win
  scales as the dashboard range narrows (the common case).
- Full parity: **13/13 identical.**
- **Deferred (careful follow-ups):** `jobs` (complex 2-path date+sort logic) and `report`
  (filters multiple date fields incl. dispute/refund dates, not just Job.date) — left on the
  old path to avoid parity risk; both still work, just not yet index-switched.

Job indexes now: `_id`, `jobDateNormalized_-1`, `tech+date`, `status+date`, `location+date`, `date_1` (6 total).

## Phase 3 — Eliminate crm-report HTTP N+1 ✅
Extracted balance-report's computation into `computeBalanceReport()` (GET is now a thin
wrapper). `crm-report` location roll-up called `/api/balance-report` over HTTP once per
technician (N+1: re-entered middleware/auth, reloaded reference data each time, forwarded the
cookie). Now calls `computeBalanceReport()` **in-process** per tech — 0 HTTP self-fetches.
- **Identical numbers proven** by unchanged balance-report parity (both modes); crm-report
  derives purely from the same function output (no lossy JSON round-trip: all fields are
  numbers/strings). Auth still enforced by crm-report's own session gate.
- typecheck clean; grep confirms `fetch(` count in crm-report = 0.

## Phase 9 — Front-end lazy-loading ◐ (biggest win done)
- **LiveAssistant** (429 LOC voice/TTS/streaming) was statically imported into the shared
  `AuthShell` layout → shipped + hydrated on EVERY route for EVERY user. Now
  `dynamic(ssr:false)` + rendered only for admins / users with a `system:ai*` permission:
  out of the shared bundle, off first-paint, not loaded for non-AI users. Build green.
- **Deferred (needs browser verification):** recharts is imported inline across 5 finance
  pages (stats, balance-report, payment-method-report, home, ChatPanel); the edit/link/row
  modals are defined *inside* the big page files. Both need component extraction + `dynamic()`
  wrappers — safe to do but must be validated in a real browser (can't here), so left for a
  browser-in-the-loop pass rather than shipped untested.

## Phase 5 — Non-destructive status canonicalization ✅
`src/lib/status-canonical.ts` (alias table + `canonicalStatus()` + known-vocab). jobs POST/PUT
populate `statusCanonical` beside untouched legacy `status`. Reads unchanged → parity preserved.
21 distinct statuses; variants (' X close'×13, 'Client Fixed It '×913, 'Customer Cenceled'×1)
= 927 jobs that WOULD reclassify if reads switch (only the 13 ' X close' touch financials).
0 unknown statuses. Unit map 6/6. Switching reads = separate owner-approved correction.

## Phase 8 — Cache reference data ✅
`src/lib/ttl-cache.ts` (global-only, 60s TTL, clear-on-write). Wrapped `getVoiceSettings` and
`getAllDetectorConfig` (both global, low-change) + invalidate in their setters. Removes a
Frankfurt round-trip from every voice/detector read. No per-user/tenant/financial data cached.
Parity 13/13 identical.

## Phase 10 — Middleware / double-JWT ✅ (retained by design, documented)
Investigated: middleware verifies the session JWT on every /api/* (401), routes verify again for
PERMISSIONS (403). This is NOT removable redundancy — the middleware is the only auth gate for any
unguarded legacy API route (flagged in the RBAC audit). Documented the security rationale in
`middleware.ts`; did NOT weaken it. Next 16 `proxy` rename is cosmetic and left for a pass that can
validate real auth flows in a browser.

## Phase 11 — Production observability ✅
`src/lib/server-timing.ts` — standard `Server-Timing` response header (durations only, never
bodies/identities/secrets; no sampling needed). Wired into home-stats (`db` + `total`). New
admin-only `GET /api/portal/admin/diagnostics` exposes `mongoHealth()` (connection state, pool
size, live DB ping ms, Vercel region) with NO URI/credentials. Verified header emits + endpoint
returns. Pattern ready to extend to other hot routes.

## Phase 5b — Switch status READS to canonical ✅ (owner-approved correction)
Backfilled `statusCanonical` on 41,738 docs (927 variants normalized: 913 'Client Fixed It ',
13 ' X close', 1 'Customer Cenceled'); legacy `status` untouched. Switched reads:
home-stats/stats/report match on `$statusCanonical`; balance-report/payment-method display+filter
via `canonicalStatus()`. payment-method status filter → statusCanonical too.

**Verification (isolated from live data drift):** the DB gained ~31 new jobs mid-session, so the
hours-old baseline had drifted (new 2026-07-30 jobs, jobsScanned 30801→30832). Compared OLD code
vs NEW code on the SAME current data (git-stash technique): finance + jobs-page1 + disputes +
refunds + report-dispute/refund + balance-report-location = **identical** (drift was not my code).
Changed exactly where expected: payment-method (926 = variant-job status displays), balance-report-tech
(58), stats (33), home-stats (24), report-penalty (4), report-provider (5). Every non-status
("OTHER") change traced to the 13 ' X close' jobs now correctly categorized; **Closed-based core
figures (totalSales, totalProfit, companyNetProfit) unchanged.** Baseline re-blessed to current data.
Backfill script: scripts/perf/migrations/backfill-status.mjs (idempotent/reversible via $unset).
