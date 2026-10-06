/**
 * Session liveness, for Warehouse.
 *
 * Warehouse verifies a token's signature, expiry, audience and claims locally.
 * What it cannot know locally is whether the session behind it still exists —
 * so it asks here, with a user id and the version its token carries.
 *
 * The answer is deliberately thin: live or not, and the current version. No
 * permissions, no role, no profile, no password state, no audit data. Warehouse
 * already has everything it is entitled to inside the token it was given; this
 * endpoint exists to invalidate, not to enrich.
 *
 * Authenticated by a dedicated service credential, never by a user session —
 * a user, however privileged, is not Warehouse.
 */
import { NextResponse } from "next/server";
import { authenticateService } from "@/lib/service-credential";
import { checkSessionLive } from "@/lib/session-version";

export const dynamic = "force-dynamic";

/** Nothing here is cacheable and nothing may be reached from a browser. */
const HEADERS = { "cache-control": "no-store" } as const;

export async function POST(req: Request) {
  const auth = authenticateService(req);
  if (!auth.ok) {
    // 503 when the deployment has no credential configured: the request was
    // well formed, this instance simply cannot answer it. 401 otherwise.
    return NextResponse.json({ error: auth.reason }, { status: auth.status, headers: HEADERS });
  }

  let body: { userId?: unknown; sessionVersion?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: HEADERS });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const presented = typeof body.sessionVersion === "number" ? body.sessionVersion : NaN;
  if (!userId || !Number.isFinite(presented)) {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: HEADERS });
  }

  const verdict = await checkSessionLive(userId, presented);

  if (!verdict.live) {
    // The reason is named because Warehouse distinguishes a revoked session
    // from an unknown user in its own logs. Nothing about the user is returned
    // either way — not even whether they exist, beyond that distinction.
    return NextResponse.json(
      { live: false, reason: verdict.reason },
      { status: 200, headers: HEADERS },
    );
  }

  return NextResponse.json(
    { live: true, sessionVersion: verdict.version },
    { status: 200, headers: HEADERS },
  );
}

/** Nothing else is allowed here, including a browser preflight. */
export function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405, headers: HEADERS });
}
