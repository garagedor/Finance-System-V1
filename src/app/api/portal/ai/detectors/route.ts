import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { ALL_DETECTORS, getDetector } from "@/lib/ai/monitors/registry";
import { getAllDetectorConfig, setDetectorConfig } from "@/lib/ai/monitors/config";

export const dynamic = "force-dynamic";

// GET: list every detector definition + its effective enabled/config state.
export async function GET() {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.type !== "admin" && !s.permissions.includes("system:ai:view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const cfg = await getAllDetectorConfig();
  const detectors = ALL_DETECTORS.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    executives: d.executives,
    defaultSeverity: d.defaultSeverity,
    enabled: cfg[d.id]?.enabled ?? d.enabledByDefault,
    configFields: d.configFields ?? [],
    config: cfg[d.id]?.config ?? {},
  }));
  return NextResponse.json({ detectors });
}

// POST: toggle enable/disable or set a config override. Requires manage rights.
export async function POST(req: NextRequest) {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.type !== "admin" && !s.permissions.includes("system:ai:manage")) {
    return NextResponse.json({ error: "Forbidden — requires AI manage permission" }, { status: 403 });
  }
  let body: { id?: unknown; enabled?: unknown; config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !getDetector(body.id)) {
    return NextResponse.json({ error: "Unknown detector id" }, { status: 400 });
  }
  const patch: { enabled?: boolean; config?: Record<string, number | boolean> } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.config && typeof body.config === "object") patch.config = body.config as Record<string, number | boolean>;
  await setDetectorConfig(body.id, patch);
  return NextResponse.json({ ok: true });
}
