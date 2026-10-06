import { NextRequest, NextResponse } from "next/server";
import { readSession, type RbacSession } from "@/lib/rbac";
import { getReportFilenames, setReportFilenames } from "@/lib/report-filenames";
import { REPORT_FILENAME_DEFAULTS, type ReportFilenamePatterns } from "@/lib/report-filename-format";

export const dynamic = "force-dynamic";

// Managing the patterns is a settings action; reading them is needed by every
// report page (incl. tech/location-manager-facing balance & stats), so GET only
// requires an active session.
function canManage(s: RbacSession): boolean {
  return s.type === "admin" || s.permissions.includes("finance:settings:view");
}

export async function GET() {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ patterns: await getReportFilenames() });
  } catch {
    // Never break a download page over a settings read — fall back to defaults.
    return NextResponse.json({ patterns: REPORT_FILENAME_DEFAULTS });
  }
}

export async function PUT(req: NextRequest) {
  const s = await readSession();
  if (!s || !s.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(s)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Partial<ReportFilenamePatterns>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Partial<ReportFilenamePatterns> = {};
  for (const k of ["balance", "stats", "finance", "custom"] as const) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No patterns provided" }, { status: 400 });
  }

  await setReportFilenames(patch);
  return NextResponse.json({ ok: true, patterns: await getReportFilenames() });
}
