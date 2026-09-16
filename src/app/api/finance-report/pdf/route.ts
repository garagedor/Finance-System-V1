// Server-side PDF endpoint for the accountant Financial Report.
//
// Gathers data via lib/financial-report (identical to the on-screen page) and
// pipes a React-PDF render into a Buffer response. The section list + title +
// prepared-for come from query params so the same data drives any layout the
// user configured on the page.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { readFile } from "fs/promises";
import path from "path";
import { readPortalSession } from "@/lib/portal-auth";
import { buildFinancialReport, SECTION_KEYS, type SectionKey } from "@/lib/financial-report";
import { FinancialReportPdf } from "@/components/pdf/FinancialReportPdf";

// Force Node runtime — @react-pdf/renderer needs Node APIs (not available on Edge).
export const runtime = "nodejs";

let cachedLogoDataUrl: string | null | undefined = undefined;
async function loadLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;
  const candidates = [
    path.join(process.cwd(), "public", "lbs-logo.png"),
    path.join(process.cwd(), "public", "lbs-logo.jpg"),
  ];
  for (const file of candidates) {
    try {
      const buf = await readFile(file);
      const ext = file.endsWith(".jpg") ? "jpeg" : "png";
      cachedLogoDataUrl = `data:image/${ext};base64,${buf.toString("base64")}`;
      return cachedLogoDataUrl;
    } catch { /* try next */ }
  }
  cachedLogoDataUrl = null;
  return cachedLogoDataUrl;
}

const csv = (v: string | null): string[] =>
  (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const safeFilename = (s: string): string =>
  String(s || "Report").replace(/[^A-Za-z0-9_\- ]/g, "").replace(/\s+/g, "_").slice(0, 60) || "Report";

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  return { from, to };
}

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sp = req.nextUrl.searchParams;
    const def = defaultRange();
    const from = sp.get("from")?.trim() || def.from;
    const to = sp.get("to")?.trim() || def.to;
    const title = (sp.get("title")?.trim() || "Financial Report").slice(0, 80);
    const preparedFor = sp.get("preparedFor")?.trim() || null;

    // Ordered, validated section list — falls back to all sections in canonical order.
    const requested = csv(sp.get("sections")).filter((k): k is SectionKey => (SECTION_KEYS as readonly string[]).includes(k));
    const sections: SectionKey[] = requested.length ? requested : [...SECTION_KEYS];

    const data = await buildFinancialReport({
      from,
      to,
      roles: csv(sp.get("roles")),
      locations: csv(sp.get("locations")),
      holders: csv(sp.get("holders")),
      includeArchived: sp.get("includeArchived") === "1",
    });

    const logoSrc = await loadLogoDataUrl();
    const element = createElement(FinancialReportPdf, { data, sections, title, preparedFor, logoSrc });
    const pdfBuffer = await renderToBuffer(element as never);

    const filename = `Financial_Report_${safeFilename(title)}_${from}_to_${to}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/finance-report/pdf error", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
