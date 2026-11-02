# 317 Live Arena — shadow validation tooling

Read-only tools for checking the Arena against the real CRM before launch. They
never write to the CRM and never send anything anywhere (no account verifier,
no notifications). Arena-side state (review decisions, shadow snapshots) lives in
a **local** MongoDB only.

All five live in `scripts/arena/` (`lib-ro-guard.ts` and `lib-shadow.ts` are shared libraries). Run them from the repository root with the
transpiling loader (CRM route modules need it):

```bash
node --env-file=<env file> --import ./scripts/arena/transpile-register.mjs scripts/arena/<script>.ts …
```

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `ARENA_CRM_RO_URI` | all | Connection string of the **read-only** CRM user. Read from the env file only; never printed, never passed on the command line. |
| `ARENA_CRM_DB` | all | CRM database name (default `ag`). |
| `ARENA_SHADOW_LOCAL_URI` | `shadow-week`, `shadow-approve`, `shadow-preflight` | Local Arena state (default `mongodb://127.0.0.1:27031`). Every host must be `127.0.0.1`; `mongodb+srv://` and remote hosts are refused. |
| `ARENA_SHADOW_DB` | `shadow-week`, `shadow-approve`, `shadow-preflight` | Local database for Arena state (default `arena_shadow`; must start with `arena_`). |

Keep the env file outside the repository, mode 600.

## The read-only CRM user

Create a dedicated database user with a **custom role** whose privileges are
`find` only, on exactly the collections the tools read:

| Collection | Why |
|---|---|
| `Job`, `Technician`, `TechNameMapping` | Arena engine and identity |
| `Location`, `Provider` | Home Leaderboard code path (`$lookup`) |
| `User` | Balance Report code path (optional — see below) |

Do **not** use Atlas's built-in `read` / `readAnyDatabase` roles: they include
`collStats`, `dbStats`, `changeStream`, `killCursors`, … and the guard refuses
anything beyond `find`, `listCollections` and `listIndexes`.

## `lib-ro-guard.ts` — the guard (used by every script)

Before any read:

1. Connects with `ARENA_CRM_RO_URI` and runs
   `adminCommand({ connectionStatus: 1, showPrivileges: true })`.
2. **Refuses (exit 3)** unless: the connection is authenticated; the user is not
   `lbs_crm_app` or `lbs_ops`; every privilege on every resource holds only
   `find` / `listCollections` / `listIndexes`; and there is at least one `find`
   on the CRM database. Any `insert`, `update`, `remove`, `createIndex`, … — on
   any collection or database, or on the cluster — is a refusal. A **built-in
   role** (`read`, `readWrite`, `readAnyDatabase`, `dbOwner`, `root`, `atlasAdmin`, …)
   is refused by name as well, even plain `read`.
3. Wraps the client in the in-process write-blocking proxy (second layer): every
   write method and every `$out` / `$merge` throws before anything is sent. CRM
   code paths called in-process (e.g. heal-on-read in Home Leaderboard) get this
   guarded client; blocked attempts are counted in the report.

Errors are reported by MongoDB code name only, so the URI never appears in output.

Note: a server running **without access control** accepts every command whatever
the user's roles say. The guard cannot see that from `connectionStatus`; the
access self-test below catches it (the write probe is accepted → FAIL).

## `shadow-verify-access.ts` — access self-test

```bash
node --env-file=<env> --import ./scripts/arena/transpile-register.mjs scripts/arena/shadow-verify-access.ts
```

Prints `PASS` / `FAIL` lines only:

- guard: read-only CRM user (user name and the collections with `find`)
- server refuses a write on `Job` — `updateOne({ _id: "__arena_probe_nonexistent__" }, …)`
  with no upsert, expected `Unauthorized` (13). The filter matches nothing, so
  even a wrongly accepted command cannot change data.
- server refuses `find` on a collection that is not granted (`users`) — expected 13
- in-process proxy blocks writes

Exit 0 when every line passes, 1 on a failed check, 3 when the guard refuses.
The probes are `accessProbes()` in `lib-ro-guard.ts`, shared with the preflight.
Run it once whenever the user or its role changes, and before the first shadow run.

## `shadow-week.ts` — one week, read-only

```bash
node --env-file=<env> --import ./scripts/arena/transpile-register.mjs \
  scripts/arena/shadow-week.ts <weekStart Monday> <outDir> [--snapshot] [--no-balance-report] [--template <templateId>]
```

Computes for the week:

- official KPIs per competitor (assigned, closed, Closing Rate, AVG TICKET, qualifying jobs) and the three eligibility gates;
- **Balanced Performance (V1)** standings and prize positions (primary) and the **Weighted (V0)** comparison under the same rules;
- the review queue the Control Center would show: suspected duplicates, CRM names without a verified person, display-name cases (needs English, unresolved collisions) and display-name flags (collisions, possible duplicate accounts);
- CRM parity: Home Leaderboard always; Balance Report when the guard sees `find` on `User` (otherwise skipped with a note) unless `--no-balance-report`. If a CRM code path fails (e.g. a missing grant), the run stops with a clear message instead of reporting false mismatches.

Rules: `--template <templateId>` uses the current version of that template from the
local Arena database; otherwise the owner-approved Balanced Performance template
from code (`SEED_BALANCED_PERFORMANCE`). Accounts are **not** verified (shadow
mode calls nothing): every account is `unverified`, which never moves a prize —
the report is a performance result, not approved winners.

`--snapshot` stores a timestamped provisional snapshot of the week (jobs + V1
standings) in `<ARENA_SHADOW_DB>.shadow_snapshot` and compares it with the previous
one for the same week: jobs added, removed (looked up by id: moved to another
week, unassigned, or deleted), edited (tech/date/status/location/profit), and
standing changes. Meant for a daily run during the shadow period.

Output: `<outDir>/<weekStart>/report.md` (owner-readable) and `data.json` (everything
structured). Files are mode 600, the directory 700. `outDir` must be outside the
repository (the output contains technician names).

Exit codes: 0 done, 1 error, 3 guard refusal.

## `shadow-preflight.ts` — one command before the Shadow GO

```bash
node --env-file=$HOME/.arena-shadow-ro.env --import ./scripts/arena/transpile-register.mjs \
  scripts/arena/shadow-preflight.ts [--out <dir>] [--shadow-dir <dir>] [--template <templateId>] \
  [--print-only] [--arena-ports 3000,3999,5173] [--min-free-gb 1] [--no-clock-check]
```

Reads only. One `PASS` / `FAIL` line per check (`NOTE`, `INFO` and `SKIP` never fail);
exit 0 when nothing fails, 1 otherwise. `--out` and `--shadow-dir` default to
`~/317-live-arena/shadow`.

| # | Check | FAIL when |
|---|---|---|
| F1 | read-only guard for `ARENA_CRM_RO_URI` | anything but `find` / `listCollections` / `listIndexes`; user `lbs_crm_app` / `lbs_ops`; any built-in role (even `read`); no `find` on the CRM db; not authenticated |
| F2 | server-side refusals (`accessProbes`) | the write probe or the read of `users` is not refused with code 13; the proxy lets a write through. Not run (FAIL) when F1 refused |
| F3 | `Job`, `Technician`, `Location`, `Provider`, `TechNameMapping` readable | any one is not. `User` is optional: a NOTE says whether the Balance Report parity will run |
| F4 | local Arena state | `ARENA_SHADOW_LOCAL_URI` not 127.0.0.1-only, `ARENA_SHADOW_DB` not `arena_*`, or not reachable |
| F5 | rules | prints the rules that will be used (methodology, minimums, targets/caps, prizes, budget, Most Improved, qualifying statuses, tie-break, review window) and the SHA-256 of their canonical JSON; FAIL when `<shadow-dir>/approved-rules.sha256` is absent ("owner has not confirmed rules yet" — INFO with `--print-only`), holds no hash, or differs |
| F6 | `<shadow-dir>/decisions.json` | absent, not JSON, or not valid against the schema below |
| F7 | technician access OFF | `ARENA_TECH_ENABLED`, `ARENA_WB_*`, `ARENA_VERIFIER`, `ARENA_PASS_*`, `WB_*`, `*SUPABASE*`, `*WEEKLY_BALANCE*` set in the environment; anything listening on a non-loopback address (0.0.0.0, ::, *, a LAN IP) on the Arena ports (default 3000, 3999, 5173; from `ss -ltnp`). Dev servers on 127.0.0.1 are fine |
| F8 | output folder | missing, not mode 700, or inside any git work tree |
| F9 | disk and clock | < 1 GB free; clock more than 2 min off the `Date` header of https://www.google.com (fallback cloudflare). Offline → SKIP with a note |

The owner confirms the rules by writing the printed fingerprint (one line) to
`~/317-live-arena/shadow/approved-rules.sha256`, mode 600. Any later change to the
rules changes the fingerprint and F5 fails.

### Decisions file (`~/317-live-arena/shadow/decisions.json`)

Arena-only decisions: they control what the Arena counts and are applied as Arena
review resolutions in the local database. **No CRM record is changed.**
`~/317-live-arena/shadow/decisions.TEMPLATE.json` is prefilled with the recommended
decisions from `DATA-REVIEW-V2.md`; nothing reads it — the owner reviews it and saves
it as `decisions.json` (mode 600).

```jsonc
{
  "schema": "arena-shadow-decisions/1",
  "note": "free text (optional)",
  "exclusions": [            // CRM names that are not competitors
    { "crmName": "CHICAGO", "category": "location_pool", "reason": "…" }
    // category: location_pool | subcontractor | not_a_person | former_technician | other
  ],
  "mappings": [              // CRM names of people
    { "crmName": "John", "status": "pending_identification", "competitorId": null, "reason": "…" },
    { "crmName": "J. Doe", "status": "attach", "competitorId": "<TechNameMapping.supabaseUserId>", "reason": "…" }
  ],
  "countOnceDuplicateGroups": [
    { "technician": "<CRM or display name>", "date": "YYYY-MM-DD", "profit": 298.23,   // or null = any
      "status": "pending_office_confirmation",                                         // or "confirmed"
      "excludeJobIds": [],                // required when confirmed: the copy(ies) to leave out
      "reason": "…" }
  ],
  "displayNameOverrides": [
    { "fullName": "<account full name>", "competitorId": null, "displayName": "Yuval M.", "reason": "…" }
  ]
}
```

Rules: every entry needs a reason; a CRM name is decided once (exclusions ∪ mappings);
`attach` needs a `competitorId` and is accepted only for a verified person; a pending
name keeps `competitorId: null` (not credited to anyone, cannot win); a `confirmed`
duplicate needs `excludeJobIds` from the same suspected group and at least one job
stays counted; a pending duplicate is counted both ways and only reported (with its
job ids, for the office); display names are Latin letters, 2–40 characters.

How they apply (`planDecisions` in `lib-shadow.ts`): exclusion → `identity_not_competitor`,
attach → `identity_attach`, confirmed duplicate → `duplicate_confirmed`, display name →
`display_name`, resolved by the simulation owner. A case already decided the same way
is "in force"; decided differently is a **conflict** and the simulated approval refuses
before anything changes.

## `shadow-approve.ts` — SIMULATED approval (local only)

```bash
node --env-file=$HOME/.arena-shadow-ro.env --import ./scripts/arena/transpile-register.mjs \
  scripts/arena/shadow-approve.ts <weekStart Monday> ~/317-live-arena/shadow \
  [--accounts <file.json>] [--accept-unverified-for-simulation] \
  [--decisions <file>] [--rules-confirmation <file>] [--template <templateId>] [--allow-early] \
  [--stop-after freeze|review] [--late-decision keep-freeze|accept-correction --late-reason "…"]
```

Runs the **real lifecycle** (`lifecycle.ts`) on the local `ARENA_SHADOW_DB`
(127.0.0.1 only): create + start the week if needed → freeze → open review → apply
the decisions file → re-check the CRM data → approve, as actor `shadow-simulation`
(the local settings are initialised with it as owner and only approver; a local
database owned by anyone else is refused). It is resumable: re-running continues from
the week's current status; an approved week is reported and left unchanged.

- **Simulation markers:** `simulated: true` on the competition, the approved result
  and the approval record; the approval note starts with `SIMULATION`; every output
  starts and ends with the SIMULATION banner.
- **Time:** refused before the week has ended and before the review window opens
  (Tuesday 12:00 America/New_York). `--allow-early` is for testing only: a loud
  warning, and the lifecycle runs on a simulated clock set just after the window
  opens (recorded in the report and `data.json`).
- **Rules:** as `shadow-week` (seed or `--template`); refused if they differ from
  `approved-rules.sha256` when that file exists (the report says when it does not).
- **Accounts:** there is no Weekly Balance connection. `--accounts` is a JSON object
  `{ "<competitorId>": "eligible" | "pending" | "inactive" | "unmapped" | "not_competing_role" }`
  the owner fills from the WB admin screen; anyone missing is `unverified`. Unverified
  never moves a prize; for the practice run it is recorded as eligible (assumed).
  If a **prize position** (Top 6 or Most Improved) is unverified the approval is
  refused (exit 2; the week stays in review) unless `--accept-unverified-for-simulation`,
  in which case the report and the approval note name those positions.
- **Lifecycle rules still apply:** e.g. a suspected duplicate that could change prizes
  and is not decided blocks the approval (exit 2), exactly like the Control Center.
- **No financial record can be created:**
  - CRM reads go through `openGuardedCrm` (server-proven read-only user + the
    write-blocking proxy); the unproxied client is never used; the report lists every
    CRM collection opened (expected: `Job`, `Technician`, `TechNameMapping`) and the
    in-process blocked write attempts (expected 0);
  - every local write is recorded as `db.collection.method`; anything outside the
    local `arena_*` collections fails the run;
  - `src/lib/arena/shadow-tooling.test.ts` asserts statically that no file under
    `src/lib/arena`, `src/app/api/arena` or `scripts/arena` opens or names a
    Ledger / Payout / `finance_*` collection, calls a ledger/payout write helper, or
    imports a ledger/payout/finance module (only `admin-service.ts` takes the CRM
    database accessor `getDb` and `newId` from `@/lib/finance-db`).
- **History integrity** after approval (same logic as `~/arena-dev/v1-proofs.ts
  integrity`): every approved record and the snapshot it approved are recomputed
  under their original rule version with today's engine and today's review
  decisions and compared field by field → `IDENTICAL` / `MISMATCH`. Other frozen
  snapshots are listed as informational: a snapshot taken before later review
  decisions is expected to differ and is never what was approved. As in
  `v1-proofs`, decisions applied later that touch a Most Improved baseline week can
  make an earlier approved week differ — apply the data-review decisions before the
  first practice approval.

- **Late CRM edits** (see `LATE-EDITS.md`): the freeze stores the exact job set (read
  time, CRM user, hashes); every re-check is diffed against it and the report lists each
  change (removed / re-dated / re-assigned / status / profit / location / added) with its
  detection time. Changes that move a prize, Most Improved or a prize-relevant
  eligibility refuse the approval (exit 2) until `--late-decision keep-freeze|accept-correction
  --late-reason "…"`. `--stop-after freeze|review` stops the run there. On an approved
  week the run re-reads the CRM and logs post-approval corrections (never applied).
- **Integrity** recomputes a snapshot that stores its source from that stored input (so
  a later CRM edit cannot make an approved week MISMATCH) and checks the approved
  record's content hash and standings against it.

Output: `<outDir>/<weekStart>-simulated-approval/report.md` and `data.json` (mode 600,
folder 700; refused inside any git repository). Exit: 0 approved (or already approved)
with safety OK and integrity IDENTICAL; 1 error, safety or integrity failure; 2 refused
by a rule (nothing approved); 3 guard refusal.

## Tests

- `src/lib/arena/shadow-guard.test.ts` (part of `npm test`): read-only passes;
  `readWrite`, `dbOwner`, the `lbs_ops` / `lbs_crm_app` users, any single write
  action, write privileges on another database or the cluster, unauthenticated
  connections and missing CRM `find` are refused; the proxy blocks writes; the
  local-state URI must be `127.0.0.1`.
- Dev proof against a real server (local only): `~/arena-dev/shadow-ro-setup.mjs`
  builds an auth-enabled mongod on `127.0.0.1:27032` with a copy of the fictional
  dev CRM and four users (`arena_shadow_ro`, `arena_shadow_ro_nouser`, `lbs_ops`,
  `arena_rw_test`); their URIs are in `~/arena-dev/shadow-ro.env` (mode 600).
- `src/lib/arena/shadow-tooling.test.ts` (part of `npm test`): decisions schema and
  plan (apply / in force / conflict / pending), accounts file, rules fingerprint,
  private output folders, technician-access checks, listener parsing, clock skew,
  write tracking and the `simulated` marker, access probes against a server that
  accepts writes, and the static "no financial record" proofs above.
- `scripts/arena/shadow-tooling.e2e.test.ts` (dev only, needs 27031 + 27032):
  ```bash
  node --test --import ./scripts/arena/transpile-register.mjs scripts/arena/shadow-tooling.e2e.test.ts
  ```
  preflight all PASS with the read-only user and correct files, and every failure
  path FAILs (read-write user, `lbs_ops`, a temporary built-in `read` user,
  unauthenticated server, non-local/unreachable state, unconfirmed/changed rules,
  missing/invalid decisions, `ARENA_TECH_ENABLED`, Supabase variables, a public
  listener, open/in-repo output folder, disk); simulated approval on fictional
  ended weeks (duplicate blocker → confirmed → approved; unverified prize positions
  refused → accounts file → approved; current week refused → `--allow-early`),
  `simulated: true` on the records, only local `arena_*` writes, the CRM on 27032
  byte-identical before/after (all collections including `finance_*`), other local
  databases untouched, integrity IDENTICAL. Uses a throwaway `arena_shadow_e2e_<pid>`
  database, dropped at the end.
- `scripts/arena/late-edits.e2e.test.ts` (dev only, same servers; run with
  `--test-concurrency=1` and never together with the file above): the late-CRM-edit story
  on a fictional week — freeze, immaterial edits listed, the trial's deleted $0 Estimate
  blocking under V0 and V1, keep-freeze / accept-correction, post-approval correction
  logged with the approved record unchanged, CRM copy byte-identical at the end.
