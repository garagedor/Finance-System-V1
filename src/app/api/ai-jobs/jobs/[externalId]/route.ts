import { NextRequest, NextResponse } from "next/server";
import {
  checkIngestAuth,
  cleanupLbsAppTestJob,
  ingestDashboardPayload,
  readLbsAppJob,
} from "@/lib/ai-jobs/dashboard-ingest";

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

// READ-BACK door (the adapter's get_status → GET {base}/jobs/{external_id}):
// the LBS App's own record — version history, origin, TEST/PRODUCTION marker,
// money, media identifiers. Same Bearer AI_INGEST_TOKEN; rows not written by
// the LBS App integration are 404 here. Read-only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ externalId: string }> }) {
  const auth = checkIngestAuth(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const { externalId } = await params;
  const result = await readLbsAppJob(externalId);
  return NextResponse.json(result.body, { status: result.status });
}

// TEST-ONLY cleanup door. Refuses (409) unless server-stamped metadata proves
// LBS App channel + TEST on every version + no human edits — see
// cleanupDecision() in lib/ai-jobs/lbs-app.ts. Never touches ag.Job, never
// deletes physical media. Repeat calls return `already_cleaned`.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ externalId: string }> }) {
  const auth = checkIngestAuth(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const { externalId } = await params;
  const result = await cleanupLbsAppTestJob(externalId);
  return NextResponse.json(result.body, { status: result.status });
}
