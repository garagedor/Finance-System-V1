# Performance Remediation — Rollback & Safety Record

**Branch:** `wip/transfer` (local only — no deploy, no merge to main)
**Started:** 2026-07-30

## Restore points (code)
- **Backup branch:** `backup/pre-perf-20260730-0423` — points at the pre-remediation commit.
- **Tag:** `pre-perf-remediation-20260730-0423`
- **Commit:** `b950e38` (Phase 2: JARVIS Safe Navigation)

### Roll back ALL code changes
```bash
cd /home/yehonatancohen/lbs-garage-door-main
git checkout wip/transfer
git reset --hard pre-perf-remediation-20260730-0423   # discards remediation commits
# or, non-destructive: git checkout backup/pre-perf-20260730-0423
```

### Roll back a single phase
Each phase is a separate commit on `wip/transfer`. `git revert <phase-commit>` undoes one phase without touching the others.

## Database safety posture
- **No destructive DB operations** are performed without explicit approval (see the approval-gated list in the task brief).
- All migrations are **additive**: new fields alongside legacy fields; legacy fields are never overwritten or dropped.
- Migrations are **idempotent + resumable** and write a progress/exception record under `perf-remediation/migrations/`.
- **No index is dropped.** New indexes only.

### Roll back an additive field migration
An additive field (e.g. `jobDateNormalized`) can be removed with a documented `$unset` migration — reversible because the legacy source field is untouched. This is an approval-gated cleanup, deferred by default.

## Financial parity harness
- `scripts/perf/capture.mjs <dir>` — snapshots 13 financial endpoints' full JSON responses to `perf-remediation/<dir>/`.
- `scripts/perf/parity.mjs <after> [<base>]` — deep-diffs two capture dirs; exits non-zero on any numeric/structural mismatch (float epsilon 1e-6).
- Baseline captured to `perf-remediation/baseline/` and verified against itself (self-test passes).
- **Rule:** after every endpoint/migration change, re-capture to a new dir and run parity. Any unexplained mismatch stops that change.

## DB profilers (read-only)
- `scripts/db-profile.mjs` — collections, counts, sizes, indexes.
- `scripts/db-explain.mjs` — explain plans on the `Job` collection.

## Baseline facts
- `Job`: 47,971 docs, 24.8 MB, **only the `_id` index**.
- Worst warm endpoint timings (dev): home-stats 7,815ms · finance 1,459ms · report-provider 1,416ms · payment-method 1,360ms.
- 28 `new MongoClient` sites; ~24 per-request/uncached.
- Production build: green (`BUILD_EXIT=0`).
