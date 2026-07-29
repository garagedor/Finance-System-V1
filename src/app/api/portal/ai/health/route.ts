import { NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { getModelStatus } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

// Health / configuration screen for the AI engine. Shows provider, configured
// vs resolved model, validation + connection status, and last validation time.
// Never exposes the API key.
export async function GET() {
  const session = await readSession();
  if (!session || !session.active) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.type !== "admin" && !session.permissions.includes("system:ai:view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = await getModelStatus();
  return NextResponse.json({ ok: status.validationStatus === "ok", ...status });
}
