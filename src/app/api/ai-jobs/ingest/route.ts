import { NextRequest, NextResponse } from "next/server";
import { ingestAiJob } from "@/lib/ai-jobs/ingest";
import type { IngestEnvelope } from "@/lib/ai-jobs/types";

// The ONLY write path into Tables AI (ag.Job_ai). Bot-facing, middleware-exempt
// (see src/middleware.ts), authenticated by the server-side AI_INGEST_TOKEN env
// var — never a session cookie, never the client bundle. Fails CLOSED if the
// token isn't configured.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function coerceEnvelope(x: any, headerKey?: string | null): IngestEnvelope {
  const env: IngestEnvelope =
    x && typeof x === "object" && x.job && typeof x.job === "object"
      ? (x as IngestEnvelope)
      : { job: x, meta: {} };
  // An Idempotency-Key header wins if the body didn't carry a stable id.
  if (headerKey && !(env.meta && env.meta.ingestId)) {
    env.meta = { ...(env.meta ?? {}), ingestId: headerKey };
  }
  return env;
}

export async function POST(req: NextRequest) {
  const token = process.env.AI_INGEST_TOKEN;
  const auth = req.headers.get("authorization");
  if (!token) {
    return NextResponse.json({ error: "Ingest not configured (AI_INGEST_TOKEN unset)" }, { status: 503 });
  }
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const headerKey = req.headers.get("idempotency-key");
  const envelopes: IngestEnvelope[] = (Array.isArray(body) ? body : [body]).map((x) => coerceEnvelope(x, headerKey));

  const results: any[] = [];
  for (const env of envelopes) {
    if (!env.job || typeof env.job !== "object" || Array.isArray(env.job)) {
      results.push({ ok: false, error: "Missing 'job' object" });
      continue;
    }
    try {
      results.push(await ingestAiJob(env));
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : "ingest failed" });
    }
  }

  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, count: results.length, results }, { status: ok ? 200 : 207 });
}
