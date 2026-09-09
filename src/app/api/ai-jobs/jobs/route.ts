import { NextRequest, NextResponse } from "next/server";
import { checkIngestAuth, ingestDashboardPayload } from "@/lib/ai-jobs/dashboard-ingest";

// CREATE door for the closing-dashboard SHADOW outbox: the adapter POSTs one
// payload_for() job here (app/jobsystem.py create_job → POST {base}/jobs).
// Middleware-exempt (see src/middleware.ts); authed by AI_INGEST_TOKEN, fails
// CLOSED if unset. Writes ONLY to ag.Job_ai — never production ag.Job.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = checkIngestAuth(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The dashboard adapter sends a single payload. Accept a bare object, an array,
  // or a {jobs:[...]} envelope so a batched or hand-rolled caller also works.
  const b = body as Record<string, unknown> | unknown[];
  const items: unknown[] = Array.isArray(b)
    ? b
    : b && typeof b === "object" && Array.isArray((b as Record<string, unknown>).jobs)
      ? ((b as Record<string, unknown>).jobs as unknown[])
      : [b];

  const results = [];
  for (const item of items) results.push(await ingestDashboardPayload(item));

  // Single write → return the plain {id,...} the adapter reads for external_id.
  if (items.length === 1) {
    return NextResponse.json(results[0].body, { status: results[0].status });
  }
  const okAll = results.every((r) => r.status < 300);
  return NextResponse.json(
    { ok: okAll, count: results.length, results: results.map((r) => r.body) },
    { status: okAll ? 200 : 207 },
  );
}
