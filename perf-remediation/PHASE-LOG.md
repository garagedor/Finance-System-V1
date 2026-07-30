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
- **Decision needed from owner:** (a) preserve exact current numbers (keep the 113× inflation),
  or (b) apply the de-dup as a documented data-quality correction (also removes the per-doc
  Provider scan → big speedup). Speed for home-stats otherwise comes from the output-neutral
  date-index path (Phases 4+6), which does NOT change any number.
- Verify script: `scripts/perf/dq-provider-dup.mjs`.
