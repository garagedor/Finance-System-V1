import "server-only";
import { ingestLbsAppJob } from "./ingest";
import { dashboardExtras, dashboardToEnvelope, externalIdFor } from "./dashboard-payload";
import { aiDb, aiJobLinksCollection, aiJobsCollection } from "./collection";
import { cleanupLbsApp, readLbsApp, type StoreColl } from "./lbs-app-store";
export { checkIngestAuth, type AuthCheck } from "./ingest-auth";

// ─────────────────────────────────────────────────────────────────────────────
// Server glue for the closing-dashboard SHADOW writes. The dashboard's outbox
// adapter (app/jobsystem.py HttpJobSystemAdapter) POSTs create → {base}/jobs and
// PUTs update → {base}/jobs/{external_id}, Bearer-authed, expecting {"id"} back.
// Both routes funnel through here: same auth, same translate+ingest, so create
// and update cannot drift. Writes land in ag.Job_ai ONLY (never ag.Job).
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardWriteResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Translate one dashboard payload_for() object and ingest it into ag.Job_ai.
 *  Echoes the stable lbs_job_id back as {"id"} so the dashboard adapter can
 *  address later updates by it (PUT /jobs/{id}). Re-sending the same
 *  lbs_job_id + version + operation is a no-op (`duplicate: true`). */
export async function ingestDashboardPayload(payload: unknown, opts: { mediaOnly?: boolean } = {}): Promise<DashboardWriteResponse> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: 400, body: { ok: false, error: "Missing job payload object" } };
  }
  const p = payload as Record<string, unknown>;
  const id = externalIdFor(p);
  if (!id) return { status: 400, body: { ok: false, error: "Missing lbs_job_id" } };
  const result = await ingestLbsAppJob(dashboardToEnvelope(p), dashboardExtras(p, opts.mediaOnly));
  if ("error" in result) return { status: result.status, body: { ok: false, error: result.error } };
  return {
    status: result.status === "created" ? 201 : 200,
    body: {
      id,
      ok: result.ok,
      status: result.status,
      duplicate: result.duplicate ?? false,
      ingestId: result.ingestId,
      duplicateProtection: result.duplicateProtection,
      validation: result.validation,
    },
  };
}

const CLEANUP_LOG = "AiJobCleanup";

/** GET /jobs/{id} — see readLbsApp (lbs-app-store.ts). Read-only. */
export async function readLbsAppJob(logicalJobId: string): Promise<DashboardWriteResponse> {
  return readLbsApp((await aiJobsCollection()) as unknown as StoreColl, logicalJobId);
}

/** DELETE /jobs/{id} — TEST-only cleanup; see cleanupLbsApp (lbs-app-store.ts). */
export async function cleanupLbsAppTestJob(logicalJobId: string): Promise<DashboardWriteResponse> {
  return cleanupLbsApp(
    {
      jobs: (await aiJobsCollection()) as unknown as StoreColl,
      links: (await aiJobLinksCollection()) as unknown as StoreColl,
      log: (await aiDb()).collection(CLEANUP_LOG) as unknown as StoreColl,
    },
    logicalJobId,
    new Date().toISOString(),
  );
}
