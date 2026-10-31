# 317 Live Arena — shadow validation tooling

Read-only tools for checking the Arena against the real CRM before launch. They
never write to the CRM and never send anything anywhere (no account verifier,
no notifications). Arena-side state (review decisions, shadow snapshots) lives in
a **local** MongoDB only.

All three live in `scripts/arena/`. Run them from the repository root with the
transpiling loader (CRM route modules need it):

```bash
node --env-file=<env file> --import ./scripts/arena/transpile-register.mjs scripts/arena/<script>.ts …
```

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `ARENA_CRM_RO_URI` | all | Connection string of the **read-only** CRM user. Read from the env file only; never printed, never passed on the command line. |
| `ARENA_CRM_DB` | all | CRM database name (default `ag`). |
| `ARENA_SHADOW_LOCAL_URI` | `shadow-week` | Local Arena state (default `mongodb://127.0.0.1:27031`). Every host must be `127.0.0.1`; `mongodb+srv://` and remote hosts are refused. |
| `ARENA_SHADOW_DB` | `shadow-week` | Local database for Arena state (default `arena_shadow`; must start with `arena_`). |

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
   any collection or database, or on the cluster — is a refusal.
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
