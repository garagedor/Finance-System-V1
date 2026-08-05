// ─────────────────────────────────────────────────────────────────────────────
// Atlas SCHEDULED Trigger (fallback): heal any Job mirror fields the change-stream
// trigger missed (e.g. during downtime or resume-token expiry). Belt & suspenders.
// Suggested schedule: every 10 minutes  →  cron  */10 * * * *
// Same $dateFromString / trim+alias semantics as the migrations. Only writes docs
// that actually need it, so it is cheap and idempotent.
// Replace SERVICE_NAME with your linked data source name.

exports = async function () {
  const SERVICE_NAME = "mongodb-atlas"; // ← your linked data source name
  const Job = context.services.get(SERVICE_NAME).db("ag").collection("Job");

  // Docs with a real date but missing/null jobDateNormalized, OR a real status
  // but missing/null statusCanonical. (Stale-but-present values are rare and get
  // corrected by the change-stream trigger on the next edit; this fallback only
  // targets the "written by external system, never mirrored" case.)
  const filter = {
    $or: [
      {
        date: { $type: "string", $nin: [null, ""] },
        $or: [{ jobDateNormalized: { $exists: false } }, { jobDateNormalized: null }],
      },
      {
        status: { $type: "string", $ne: "" },
        $or: [{ statusCanonical: { $exists: false } }, { statusCanonical: null }],
      },
    ],
  };

  const pipeline = [
    {
      $set: {
        jobDateNormalized: {
          $cond: [
            { $and: [{ $eq: [{ $type: "$date" }, "string"] }, { $ne: ["$date", ""] }] },
            { $dateFromString: { dateString: "$date", onError: null, onNull: null } },
            "$$REMOVE",
          ],
        },
        statusCanonical: {
          $cond: [
            { $and: [{ $eq: [{ $type: "$status" }, "string"] }, { $ne: [{ $trim: { input: "$status" } }, ""] }] },
            {
              $let: {
                vars: { t: { $trim: { input: "$status" } } },
                in: {
                  $switch: {
                    branches: [{ case: { $eq: ["$$t", "Customer Cenceled"] }, then: "Customer Canceled" }],
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
  ];

  const res = await Job.updateMany(filter, pipeline);
  console.log(`mirror-fields fallback: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
};
