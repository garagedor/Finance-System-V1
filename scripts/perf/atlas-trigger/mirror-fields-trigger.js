// ─────────────────────────────────────────────────────────────────────────────
// Atlas Database Trigger: Job mirror-field self-heal
// ─────────────────────────────────────────────────────────────────────────────
// WHY: Some jobs are written to the `ag.Job` collection by an EXTERNAL system
// that bypasses /api/jobs and never sets `jobDateNormalized` / `statusCanonical`.
// The reports filter bounded date ranges on `jobDateNormalized` and the closed
// tab on `statusCanonical`, so those jobs silently disappear from the report.
// This trigger recomputes both mirror fields on every insert/update/replace,
// using the EXACT same semantics as:
//   - scripts/perf/migrations/backfill-jobdate.mjs  ($dateFromString on `date`)
//   - scripts/perf/migrations/backfill-status.mjs   (trim + documented alias)
//   - src/api/jobs/route.ts + src/lib/status-canonical.ts
// It never touches the legacy `date` / `status` strings.
//
// IDEMPOTENT / NO RECURSION: the update is an aggregation pipeline that sets the
// fields to their computed value. When the fields are already correct the write
// is a no-op, so MongoDB emits NO change event and the trigger does not re-fire.
// A genuine change to `date`/`status` recomputes once, then settles.
//
// SETUP: see README.md in this folder. Replace SERVICE_NAME below with your
// linked cluster's service name (App Services → Linked Data Sources).

exports = async function (changeEvent) {
  const SERVICE_NAME = "mongodb-atlas"; // ← your linked data source name

  try {
    const _id = changeEvent.documentKey && changeEvent.documentKey._id;
    if (_id === undefined || _id === null) return;

    const Job = context.services.get(SERVICE_NAME).db("ag").collection("Job");

    await Job.updateOne({ _id: _id }, [
      {
        $set: {
          // jobDateNormalized === $dateFromString($date) for real string dates;
          // absent otherwise (mirrors backfill-jobdate.mjs targetFilter).
          jobDateNormalized: {
            $cond: [
              {
                $and: [
                  { $eq: [{ $type: "$date" }, "string"] },
                  { $ne: ["$date", ""] },
                ],
              },
              { $dateFromString: { dateString: "$date", onError: null, onNull: null } },
              "$$REMOVE",
            ],
          },
          // statusCanonical === trim(status) with the one documented alias
          // (mirrors backfill-status.mjs / src/lib/status-canonical.ts).
          statusCanonical: {
            $cond: [
              {
                $and: [
                  { $eq: [{ $type: "$status" }, "string"] },
                  { $ne: [{ $trim: { input: "$status" } }, ""] },
                ],
              },
              {
                $let: {
                  vars: { t: { $trim: { input: "$status" } } },
                  in: {
                    $switch: {
                      branches: [
                        { case: { $eq: ["$$t", "Customer Cenceled"] }, then: "Customer Canceled" },
                      ],
                      default: "$$t",
                    },
                  },
                },
              },
              "$$REMOVE",
            ],
          },
        },
      },
    ]);
  } catch (err) {
    console.error("mirror-fields-trigger error:", err && err.message ? err.message : err);
  }
};
