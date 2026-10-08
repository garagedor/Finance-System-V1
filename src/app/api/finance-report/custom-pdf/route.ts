// Custom itemized report → PDF. Receives the hand-picked items (grouped by
// category) and renders one grouped PDF with subtotals + a grand total. The
// amounts were server-computed by /api/portal/custom-report/items at pick time.
//
// Ledger lines are the exception: they are rebuilt here from the database by
// entry id, and any `detail` the browser sends is ignored. That is what keeps
// a PROVIDER report PROVIDER-safe — if any picked line sits on a PROVIDER
// ledger, every dispute/refund line in the PDF uses the PROVIDER projection,
// so the internal cost-share split never reaches the file.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { readFile } from "fs/promises";
import path from "path";
import { readPortalSession } from "@/lib/portal-auth";
import { CustomReportPdf, type CustomPdfGroup, type CustomPdfItem } from "@/components/pdf/CustomReportPdf";
import { getReportFilenames } from "@/lib/report-filenames";
import { buildReportFilename } from "@/lib/report-filename-format";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { ledgerLineItems } from "@/lib/custom-report";
import { isProviderLedgerRole } from "@/lib/dispute-detail";
import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";

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
    const rawItems = (g: Record<string, unknown>) => (Array.isArray(g.items) ? g.items as Array<Record<string, unknown>> : []);

    // Ledger lines, re-read by id. A line that no longer exists is dropped
    // rather than printed from what the browser remembered.
    const lineIds = [...new Set(rawGroups.filter((g) => g.type === "ledgerLine").flatMap((g) => rawItems(g).map((it) => String(it.id ?? ""))).filter(Boolean))];
    const rebuilt = new Map<string, CustomPdfItem>();
    if (lineIds.length) {
      await ensureFinanceIndexes();
      const entries = await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).find({ _id: { $in: lineIds } }).toArray();
      const ledgerIds = [...new Set(entries.map((e) => e.ledger_id))];
      const ledgers = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).find({ _id: { $in: ledgerIds } }).toArray();
      const roleOf = new Map(ledgers.map((l) => [l._id, l.role]));
      // One PROVIDER ledger makes the whole report PROVIDER-facing. A ledger
      // that cannot be found counts as PROVIDER: ambiguity never exposes the split.
      const providerSafe = ledgerIds.some((id) => !roleOf.has(id) || isProviderLedgerRole(roleOf.get(id)));
      // A PROVIDER report cannot carry another party's ledger: even relabelled,
      // the line amount IS that party's charge.
      const others = ledgers.filter((l) => !isProviderLedgerRole(l.role));
      if (providerSafe && others.length) {
        return NextResponse.json({
          error: `This report mixes a PROVIDER ledger with ${others.map((l) => `${l.holder_name} (${String(l.role).replace(/_/g, " ")})`).join(", ")}. A PROVIDER report can only include PROVIDER ledger lines — remove the others or make a separate report.`,
        }, { status: 400 });
      }
      for (const row of await ledgerLineItems(entries, providerSafe)) {
        rebuilt.set(row.id, { date: row.date, primary: row.primary, secondary: row.secondary, amount: row.amount, detail: row.detail ?? null });
      }
    }

    const groups: CustomPdfGroup[] = rawGroups.map((g) => {
      const items: CustomPdfItem[] = g.type === "ledgerLine"
        ? rawItems(g).map((it) => rebuilt.get(String(it.id ?? ""))).filter((it): it is CustomPdfItem => !!it)
        : rawItems(g).map((it) => ({
            date: String(it.date ?? ""),
            primary: String(it.primary ?? ""),
            secondary: String(it.secondary ?? ""),
            amount: r2(Number(it.amount)),
            // Only ledger lines carry a breakdown, and those are rebuilt above.
            detail: null,
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

    const patterns = await getReportFilenames();
    const filename = buildReportFilename(patterns.custom, {
      subject: title,
      preparedFor: preparedFor ?? "",
      start: from,
      end: to,
      today: new Date().toISOString().slice(0, 10),
    }, "Custom_Report");
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
