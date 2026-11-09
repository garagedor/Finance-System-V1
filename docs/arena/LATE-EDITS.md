# 317 Live Arena — late CRM edits

**The problem.** The CRM can be changed after a week has ended. A job can be deleted,
moved to another date, given to another technician, or have its status or profit edited.
The real-data trial found exactly this: between 29 Oct and 2 Nov one technician's week
2026-10-19 went from 35 assigned / 20 closed / 30 qualifying jobs to 34 / 20 / 29. A
$0, non-closed, qualifying job had left the week, and under the old method that
changed his rank.

**The rule.** Once a week is frozen, a change in the CRM never moves a prize by itself.
The Arena notices the change, lists it, and if it would change who wins what, the owner
has to choose what happens. Once results are approved they never change.

## 1. What is stored at the freeze (the "source snapshot")

When a week freezes (Monday 00:00 in the competition timezone), the Arena saves the
standings together with **exactly what they were computed from**:

- every CRM job it read for the week (and for the Most Improved baseline weeks):
  job id, technician, service date, status, location and profit (the Balance Report's
  profit);
- who the technicians are (the name mapping), the review decisions in force, and the
  Weekly Balance account standings it used;
- **when** the CRM was read, and **from where**: database, collection (`Job`) and the
  database user (only the user name, never a password);
- fingerprints (SHA-256): one of the job list, one of all the inputs together, and one of
  the computed standings.

Running the scoring again on that stored input gives the same standings, bit for bit
(the fingerprints match). This is checked when the snapshot is written (`reproducible`)
and again before approval. It does not depend on what the CRM looks like later.

Code: `src/lib/arena/source-snapshot.ts` (`buildSource`, `computeFromSource`,
`verifySnapshotSource` in `lifecycle.ts`).

## 2. Every later re-read is compared with the freeze

Opening the review, and every "Re-check CRM data", reads the CRM again. That read is
compared **job by job** with the freeze snapshot. Each change gets a line:

| Change | What it means |
|---|---|
| Job removed | deleted from the CRM |
| Re-dated out of the week | the job now has another date (or no valid date) |
| Re-assigned | the job now belongs to another technician (or nobody) |
| Status edited / Profit edited / Location edited | the job is still there, a field changed |
| Job added | new in the read: a late entry, or moved into the week |

A job that disappeared from the read is looked up by its id (read-only) to tell
"deleted" from "moved to another date" from "unassigned".

**Times.** Each change shows **when the Arena detected it** (the time of the re-read).
The CRM job documents **do not carry an "updated at" field** — the CRM's own job API
does not record when a job was edited — so the actual edit time is **not known**, and the
Arena says so instead of guessing. If the CRM ever starts writing one of `updatedAt`,
`updated_at`, `lastModified`, `modifiedAt` or `lastUpdated`, it is picked up and shown
next to the detection time automatically.

## 3. Does the change matter?

To measure only the CRM edits (not review decisions taken meanwhile), the Arena scores
the **frozen job set** and the **new job set** with everything else identical, and
compares the two. A change is **material** when it:

- moves any prize position or amount (e.g. #3 ↔ #4);
- changes who wins Most Improved; or
- changes the eligibility of a prize-relevant competitor (anyone holding a prize in
  either version, or ranked at or above the last prize holder).

Anything else (ranks or scores moving below the prize zone, a status change that
doesn't count, a profit edit that leaves every prize where it was) is **listed but does
not block**.

## 4. When it matters: approval is blocked until the owner chooses

If the snapshot under review has material late changes, **approval is refused** (in the
Control Center and in the API — `approveResults` checks it). The owner sees the list of
changes, the before/after standings, and two buttons:

- **Keep freeze snapshot** — the week is scored on the job set stored at the freeze
  (with today's review decisions). The CRM edit is ignored for this week.
- **Accept correction** — the week is scored on the corrected CRM data.

A reason is required. Only the owner can choose. The choice writes a **new** reviewed
snapshot (nothing is overwritten) and an audit entry with the reason. A later re-check
that finds the *same* changes keeps the choice; a *new* material change blocks again.

Code: `decideLateChanges`, `lateChangeBlockers`, `snapshotBlockers` in `lifecycle.ts`;
Control Center action `late_decision`; panel in `ResultsPanel.tsx`.

## 5. After approval: detected, logged, never applied

The approved record is immutable (one per week, content-hashed, insert-only). If the
CRM changes afterwards:

- "Check CRM for late corrections" (Control Center, approved weeks) or a re-run of the
  shadow approval re-reads the CRM and compares it with the job set the approved result
  was computed from;
- any change is written once to `arena_late_correction` (insert-only), with the same
  change list and the effect it would have had, and an audit entry;
- the approved result, its snapshot, the prize list, the approval record and the
  technician feed are **not touched** — the history integrity check stays **IDENTICAL**
  because it recomputes from the stored source snapshot;
- the owner handles it manually. **No payout, ledger or other financial record exists
  in the Arena or is created.**

Code: `checkLateCorrections` in `lifecycle.ts`; action `late_check`.

## Shadow tooling

`scripts/arena/shadow-approve.ts` runs the same lifecycle on the local copy and puts all
of this in its report: the freeze source snapshot (read time, CRM user, job count and
hashes), the late-change table and its effect, whether approval is blocked, the owner's
decision, and post-approval corrections. New options:

```
--stop-after freeze|review           stop there (to let the CRM change in between)
--late-decision keep-freeze|accept-correction --late-reason "…"
```

Proof on fictional data: `scripts/arena/late-edits.e2e.test.ts` (dev only; needs the
local 27031 and the access-controlled 27032 copy):

```bash
node --test --test-concurrency=1 --import ./scripts/arena/transpile-register.mjs scripts/arena/late-edits.e2e.test.ts
```

Unit tests: `src/lib/arena/late-edits.test.ts` (part of `npm test`).

## Limits (said plainly)

- Edit times are not known (see 2). Two changes made between the same two reads look
  simultaneous.
- Changes are seen when the CRM is re-read: at review, on "Re-check", and on a
  post-approval check. The daily cron only freezes; it does not run the post-approval
  check by itself.
- Changes to the technician name mapping or the Technician list are not part of the
  job-level comparison (they are part of the stored input, so a stored result still
  reproduces exactly).
- Snapshots frozen before this feature have no stored source: they keep the old
  behaviour (no job-level comparison; integrity falls back to today's CRM).
