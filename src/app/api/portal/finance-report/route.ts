// On-screen JSON for the accountant Financial Report page. Delegates all
// computation to lib/financial-report (the same gatherer the PDF route uses),
// so the preview on screen and the printed PDF always match.

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { buildFinancialReport } from "@/lib/financial-report";

export const dynamic = "force-dynamic";

const csv = (v: string | null): string[] =>
  (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  return { from, to };
}

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const def = defaultRange();
  const from = sp.get("from")?.trim() || def.from;
  const to = sp.get("to")?.trim() || def.to;

  try {
    const data = await buildFinancialReport({
      from,
      to,
      roles: csv(sp.get("roles")),
      locations: csv(sp.get("locations")),
      holders: csv(sp.get("holders")),
      includeArchived: sp.get("includeArchived") === "1",
      includeLedgerDetail: sp.get("detail") === "1",
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/portal/finance-report error", err);
    return NextResponse.json({ error: "Failed to build the financial report" }, { status: 500 });
  }
}
