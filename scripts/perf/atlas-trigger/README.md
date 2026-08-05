# Atlas Trigger — Job mirror-field self-heal

## The problem it solves
An **external system** (not `/api/jobs`) writes some jobs straight into `ag.Job`
without setting `jobDateNormalized` or `statusCanonical`. The reports filter
bounded date ranges on `jobDateNormalized` and the closed tab on
`statusCanonical`, so those jobs **silently vanish from the report**. We keep
having to re-run the backfill by hand. These triggers make the database
**self-heal** so it stops recurring.

Two triggers (use both — the scheduled one is a safety net for events the
change-stream misses):

| File | Type | Fires |
|---|---|---|
| `mirror-fields-trigger.js` | Database trigger (change stream) | on every Job insert / update / replace |
| `mirror-fields-scheduled-fallback.js` | Scheduled trigger | every 10 min, heals stragglers |

Both recompute the mirror fields with the **exact same semantics** as
`scripts/perf/migrations/backfill-jobdate.mjs` and `backfill-status.mjs`
(`$dateFromString` on `date`; `trim` + the `Customer Cenceled`→`Customer
Canceled` alias on `status`). Neither touches the legacy `date` / `status`
strings. Both are idempotent.

## Setup (Atlas UI, ~5 min)

1. **Atlas → App Services** (top nav). Create an App if none exists (choose the
   cluster that hosts the `ag` database). Note the **Linked Data Source name**
   under *Linked Data Sources* — default is usually `mongodb-atlas` (or
   `Cluster0`). Put that exact name into the `SERVICE_NAME` constant in both JS
   files.

2. **Change-stream trigger**
   - App Services → **Triggers → Add Trigger** → type **Database**.
   - Link to your data source; **Database** `ag`, **Collection** `Job`.
   - **Operation Type**: check **Insert**, **Update**, **Replace**.
   - **Full Document**: OFF (not needed — the pipeline reads the doc server-side).
     Full Document on Update: OFF.
   - **Event Ordering**: ON.
   - **Function**: paste the contents of `mirror-fields-trigger.js`.
   - Save & deploy.

3. **Scheduled fallback**
   - Triggers → **Add Trigger** → type **Scheduled**.
   - Schedule → **Advanced (cron)**: `*/10 * * * *` (every 10 minutes).
   - **Function**: paste the contents of `mirror-fields-scheduled-fallback.js`.
   - Save & deploy.

## Verify it works
1. Deploy both triggers.
2. Insert a test job directly (mongosh) **without** the mirror fields:
   ```js
   db.Job.insertOne({ date: "2026-08-05", status: " X close ", _triggerTest: true })
   ```
3. Within a second (change-stream) or ≤10 min (fallback):
   ```js
   db.Job.findOne({ _triggerTest: true })
   // jobDateNormalized: ISODate("2026-08-05T00:00:00Z"), statusCanonical: "X close"
   ```
4. Clean up: `db.Job.deleteOne({ _triggerTest: true })`.

## Recursion / cost
The update sets each field to its computed value. When the fields are already
correct the write is a **no-op**, so MongoDB emits **no change event** and the
trigger does not re-fire. A real edit to `date`/`status` recomputes once and then
settles. Cost is one tiny `updateOne` per Job write.

## Notes
- This is defense-in-depth. The *ideal* fix is for the external writer to set
  the fields itself (or route through `/api/jobs`, which already does). Until we
  can identify/change that writer, these triggers keep the report correct.
- If you ever change the canonical logic, update it in **four** places to stay in
  parity: these two trigger files, the two `backfill-*.mjs` migrations, and
  `src/lib/status-canonical.ts` / `src/app/api/jobs/route.ts`.
