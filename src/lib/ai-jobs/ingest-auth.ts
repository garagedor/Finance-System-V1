// Bearer-token auth for the bot-facing Tables AI doors (/api/ai-jobs/ingest and
// /api/ai-jobs/jobs*). Fails CLOSED (503) if AI_INGEST_TOKEN is unset, 401 on
// mismatch. Never a session cookie; the token is never logged or echoed.

export type AuthCheck = { ok: true } | { ok: false; status: number; body: unknown };

export function checkIngestAuth(authHeader: string | null): AuthCheck {
  const token = process.env.AI_INGEST_TOKEN;
  if (!token) return { ok: false, status: 503, body: { error: "Ingest not configured (AI_INGEST_TOKEN unset)" } };
  if (authHeader !== `Bearer ${token}`) return { ok: false, status: 401, body: { error: "Unauthorized" } };
  return { ok: true };
}
