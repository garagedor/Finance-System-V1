// Server-side Statistics PDF — renders the same data as the /stats page
// (computeStats) into a branded landscape report, mirroring /api/balance-report/pdf.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { readFile } from "fs/promises";
import path from "path";
import { computeStats } from "@/app/api/stats/route";
import { StatsReportPdf } from "@/components/pdf/StatsReportPdf";

export const runtime = "nodejs";

let cachedLogoDataUrl: string | null | undefined = undefined;
async function loadLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;
  for (const file of [path.join(process.cwd(), "public", "lbs-logo.png"), path.join(process.cwd(), "public", "lbs-logo.jpg")]) {
    try {
      const buf = await readFile(file);
      cachedLogoDataUrl = `data:image/${file.endsWith(".jpg") ? "jpeg" : "png"};base64,${buf.toString("base64")}`;
      return cachedLogoDataUrl;
    } catch { /* next */ }
  }
  cachedLogoDataUrl = null;
  return cachedLogoDataUrl;
}

const safeFilename = (s: string): string => String(s || "Report").replace(/[^A-Za-z0-9_\- ]/g, "").replace(/\s+/g, "_").slice(0, 60) || "Report";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const startDate = sp.get("startDate") || "";
    const endDate = sp.get("endDate") || "";
    const techs = sp.getAll("tech").map((t) => t.trim()).filter(Boolean);
    const locations = sp.getAll("location").map((l) => l.trim()).filter(Boolean);
    const providers = sp.getAll("provider").map((p) => p.trim()).filter(Boolean);
    const title = (sp.get("title")?.trim() || "Statistics Report").slice(0, 80);

    const data = await computeStats({ startDate, endDate, techs, locations, providers });
    const logoSrc = await loadLogoDataUrl();
    const element = createElement(StatsReportPdf, {
      title, startDate, endDate, filters: { techs, locations, providers }, data, logoSrc,
    });
    const pdfBuffer = await renderToBuffer(element as never);

    const filename = `Statistics_Report_${safeFilename(title)}_${startDate}_to_${endDate}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/stats/pdf error", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
