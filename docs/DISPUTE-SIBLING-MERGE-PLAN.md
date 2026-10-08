# Merging the parallel dispute records — plan only, nothing executed

**Status:** proposed, not approved, not run. No production data has been
mutated by anything in this document or by the code that found it.

## What exists

Before one dispute could carry several ledger postings, charging a second
party meant creating a second `finance_dispute` from a ledger page. The
result, measured read-only against `ag`:

| Finding | Count |
|---|---|
| `DUPLICATE_RECORDS` — two records, same job, same amount | 23 groups |
| …of which the Posted tab would have offered an already-charged party | 17 items |
| `LEDGER_NOT_LINKED` — a live entry on a record no inbox item points at | 21 |
| `CHARGED_NOT_LINKED` — marked charged, nothing linked | 8 |
| `REVERSAL_REOPENED` — charged, reversed, nothing live in its place | 3 |
| `TARGET_CHARGED_TWICE` | **0** |
| `LINK_DANGLING` / `LINK_WRONG_JOB` | **0** |

The typical shape is one economic dispute written twice: the provider slice
posted from a ledger page as `disp_muke…`, the Area-Manager slice posted
from the inbox as `disp_muu…`/`disp_muy…`, same job, same amount.

**Nobody has been double-charged.** The records are split, not duplicated.

## Why this is not urgent

The sibling guard already stops the duplicate: a target charged under a
record with the same job and amount is refused, server-side, with the
sibling's id in the message. The merge is tidying, not safety.

Running it badly is worse than not running it. Two records on one job at the
same amount *can* be two genuine disputes — rare, but the data cannot prove
otherwise, which is why the guard refuses rather than merges.

## The migration, if approved

**Principle: re-point, never delete.** The ledger entries are the money and
are not touched. Only `dispute_id` on an entry and a pointer on the inbox
item change, and both are recorded so they can be put back.

For each confirmed group:

1. **Elect the survivor** — the record an inbox item already points at
   (`postedRecordId`). If none does, the oldest by `created_at`.
2. **Write a reversal journal** to `finance_dispute_merge_audit` *before*
   touching anything: group id, survivor, absorbed ids, every entry id with
   its current `dispute_id`, and the operator. This is what makes step 5
   possible.
3. **Re-point the entries** — `finance_ledger_entry.dispute_id` from the
   absorbed record to the survivor. The entry's `ledger_id`, `amount`,
   `date`, `description` and `charge_snapshot` are untouched: no balance on
   any ledger moves by a cent.
4. **Stamp `posted_party`** on each re-pointed entry from its
   `charge_snapshot.posted_party`, falling back to `combined`. This is the
   same inference the read path already applies, so nothing changes meaning
   — it only becomes indexed.
5. **Mark the absorbed record** `merged_into: <survivor>` and
   `status: "merged"`. **Do not delete it.** Its id appears in the audit
   journal, in `charge_snapshot.sourceDisputeOrRefundId`, and possibly in
   exports already sent to an Area Manager.
6. **Re-run `npm run reconcile:disputes`** and require
   `TARGET_CHARGED_TWICE = 0` and `DUPLICATE_RECORDS` reduced by exactly the
   number of groups processed.

### Preconditions (all must hold, checked per group, in a dry run first)

- Every entry in the group is live, or reversed with its reversal intact.
- The survivor and the absorbed records agree on `job_id` and amount.
- No two entries in the group share an inferred target — merging those
  would create the `TARGET_CHARGED_TWICE` condition the guard exists to
  prevent. **Such a group is skipped and reported, never merged.**
- The unique index `{dispute_id, posted_party}` exists, so step 3 fails
  loudly rather than silently creating a duplicate.

### Rollback

From the journal written in step 2, in reverse order:

1. Restore each entry's original `dispute_id`.
2. Clear `merged_into` and restore the absorbed record's `status`.
3. Re-run the reconciliation report and compare to the pre-merge output,
   which the journal stores verbatim.

Rollback is a field-level restore of two scalars per entry. No entry is
created or destroyed at any point, so no balance can drift either way.

### Sequencing

Deploy the guard first and let it run. The guard makes the duplicate
impossible; the merge only makes the history tidy. If the merge is ever run,
it should be after the guard has been live long enough that no new parallel
records are being created — which the reconciliation report will show as
`DUPLICATE_RECORDS` holding flat.

## The other four findings

- **`CHARGED_NOT_LINKED` (8)** — handled in code, not by migration. Every
  one is under `REVIEW_REQUIRED` and refuses all posting. An operator
  clears it by checking the ledger and, if no money moved, unmarking the
  charge on the item; the targets then become available. No data fix needed.
- **`LEDGER_NOT_LINKED` (21)** — informational. These are the provider
  charges from the bulk session. They are real money on the right ledger;
  they simply have no inbox item pointing at them. The merge above resolves
  most of them as a side effect.
- **`REVERSAL_REOPENED` (3)** — correct and intended. The charge was
  reversed, so the target is chargeable again and the system says so.
- **`TARGET_CHARGED_TWICE` (0)** — nothing to fix.
