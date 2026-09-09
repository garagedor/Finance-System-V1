import "server-only";
import { ingestAiJob } from "./ingest";
import { dashboardToEnvelope, externalIdFor } from "./dashboard-payload";

// ─────────────────────────────────────────────────────────────────────────────
// Server glue for the closing-dashboard SHADOW writes. The dashboard's outbox
// adapter (app/jobsystem.py HttpJobSystemAdapter) POSTs create → {base}/jobs and
// PUTs update → {base}/jobs/{external_id}, Bearer-authed, expecting {"id"} back.
// Both routes funnel through here: same auth, same translate+ingest, so create
// and update cannot drift. Writes land in ag.Job_ai ONLY (never ag.Job).
// ─────────────────────────────────────────────────────────────────────────────

export type AuthCheck = { ok: true } | { ok: false; status: number; body: unknown };

/** Bearer-token auth, identical to /api/ai-jobs/ingest. Fails CLOSED (503) if
 *  AI_INGEST_TOKEN is unset, 401 on mismatch. Never a session cookie. */
export function checkIngestAuth(authHeader: string | null): AuthCheck {
  const token = process.env.AI_INGEST_TOKEN;
  if (!token) return { ok: false, status: 503, body: { error: "Ingest not configured (AI_INGEST_TOKEN unset)" } };
  if (authHeader !== `Bearer ${token}`) return { ok: false, status: 401, body: { error: "Unauthorized" } };
  return { ok: true };
}

export interface DashboardWriteResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Translate one dashboard payload_for() object and ingest it into ag.Job_ai.
 *  Echoes the stable lbs_job_id back as {"id"} so the dashboard adapter can
 *  address later updates by it (PUT /jobs/{id}). */
export async function ingestDashboardPayload(payload: unknown): Promise<DashboardWriteResponse> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: 400, body: { ok: false, error: "Missing job payload object" } };
  }
  const p = payload as Record<string, unknown>;
  const envelope = dashboardToEnvelope(p);
  const result = await ingestAiJob(envelope);
  const id = externalIdFor(p) ?? result.id;
  return {
    status: result.status === "created" ? 201 : 200,
    body: {
      id,
      ok: result.ok,
      status: result.status,
      ingestId: result.ingestId,
      duplicateProtection: result.duplicateProtection,
      validation: result.validation,
    },
  };
}
