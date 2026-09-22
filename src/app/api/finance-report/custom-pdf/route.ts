// Custom itemized report → PDF. Receives the hand-picked items (grouped by
// category) and renders one grouped PDF with subtotals + a grand total. The
// amounts were server-computed by /api/portal/custom-report/items at pick time.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { readFile } from "fs/promises";
import path from "path";
import { readPortalSession } from "@/lib/portal-auth";
import { CustomReportPdf, type CustomPdfGroup, type CustomPdfItem } from "@/components/pdf/CustomReportPdf";

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

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const safeFilename = (s: string): string => String(s || "Report").replace(/[^A-Za-z0-9_\- ]/g, "").replace(/\s+/g, "_").slice(0, 60) || "Report";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = (String(body.title ?? "").trim() || "Custom Report").slice(0, 80);
    const from = String(body.from ?? "").trim();
    const to = String(body.to ?? "").trim();
    const preparedFor = body.preparedFor ? String(body.preparedFor).trim() : null;

    const rawGroups = Array.isArray(body.groups) ? (body.groups as Array<Record<string, unknown>>) : [];
    const groups: CustomPdfGroup[] = rawGroups.map((g) => {
      const items: CustomPdfItem[] = (Array.isArray(g.items) ? g.items as Array<Record<string, unknown>> : []).map((it) => ({
        date: String(it.date ?? ""),
        primary: String(it.primary ?? ""),
        secondary: String(it.secondary ?? ""),
        amount: r2(Number(it.amount)),
      }));
      const subtotal = r2(items.reduce((sum, it) => sum + it.amount, 0));
      return {
        type: String(g.type ?? "group"),
        label: String(g.label ?? "Items"),
        amountLabel: String(g.amountLabel ?? "Amount"),
        items,
        subtotal,
      };
    }).filter((g) => g.items.length > 0);

    if (groups.length === 0) return NextResponse.json({ error: "Select at least one item" }, { status: 400 });
    const grandTotal = r2(groups.reduce((sum, g) => sum + g.subtotal, 0));

    const logoSrc = await loadLogoDataUrl();
    const element = createElement(CustomReportPdf, { title, from, to, preparedFor, logoSrc, groups, grandTotal });
    const pdfBuffer = await renderToBuffer(element as never);

    const filename = `Custom_Report_${safeFilename(title)}_${from}_to_${to}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("POST /api/finance-report/custom-pdf error", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
