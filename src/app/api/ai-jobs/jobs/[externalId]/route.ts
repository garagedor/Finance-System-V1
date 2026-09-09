import { NextRequest, NextResponse } from "next/server";
import { checkIngestAuth, ingestDashboardPayload } from "@/lib/ai-jobs/dashboard-ingest";

// UPDATE door for the closing-dashboard SHADOW outbox: the adapter PUTs a
// corrected job here (app/jobsystem.py update_job → PUT {base}/jobs/{external_id}).
// The payload already carries lbs_job_id; the path param is the external_id we
// echoed on create. Same upsert path as POST — corrections update the SAME
// ag.Job_ai row (aiOriginal stays frozen), with the out-of-order version guard
// in ingestAiJob. Writes ONLY to ag.Job_ai — never production ag.Job.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ externalId: string }> }) {
  const auth = checkIngestAuth(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { externalId } = await params;
  // Belt-and-suspenders: the body's lbs_job_id is authoritative, but if a caller
  // ever omits it, fall back to the id in the path so the upsert still keys right.
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (b.lbs_job_id == null && externalId) b.lbs_job_id = externalId;
  }

  const result = await ingestDashboardPayload(body);
  return NextResponse.json(result.body, { status: result.status });
}
