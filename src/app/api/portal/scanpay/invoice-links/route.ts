// Invoice-link suggestions (Banking → Invoice links).
//   POST { action: "link", invoiceNumber, jobId }   → save the invoice on the job, close the suggestion
//   POST { action: "dismiss", invoiceNumber }       → not any of these jobs
//   POST { action: "run" }                          → run the auto-link now (same as the daily run)
// Deciding needs admin or finance:banking:reconcile.

import { NextRequest, NextResponse } from "next/server";
import { readSession, hasPermission } from "@/lib/rbac";
import { coll, getDb, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { syncInvoiceLinks, type LinkSuggestionRecord } from "@/lib/scanpay/invoice-link-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const s = await readSession();
  if (!s || !(s.type === "admin" || hasPermission(s, "finance:banking:reconcile"))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { action?: string; invoiceNumber?: string; jobId?: string };
  const S = coll<LinkSuggestionRecord>(FINANCE_COLLECTIONS.scanpayLinkSuggestion);
  const now = new Date().toISOString();

  if (b.action === "run") {
    try {
      return NextResponse.json({ ok: true, result: await syncInvoiceLinks({ sinceDays: 35, budgetMs: 90_000 }) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
    }
  }

  const invoiceNumber = String(b.invoiceNumber ?? "").trim();
  const sug = await S.findOne({ _id: invoiceNumber } as never);
  if (!sug) return NextResponse.json({ error: "Unknown suggestion" }, { status: 404 });

  if (b.action === "dismiss") {
    await S.updateOne({ _id: invoiceNumber } as never, { $set: { status: "dismissed", decidedBy: s.name, updated_at: now } } as never);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "link") {
    const jobId = String(b.jobId ?? "");
    if (!sug.candidates.some((c) => c.jobId === jobId)) return NextResponse.json({ error: "That job isn't one of the suggestions" }, { status: 400 });
    const db = await getDb();
    const { ObjectId } = await import("mongodb");
    const other = await db.collection("Job").findOne({ invoiceNumber }, { projection: { clientName: 1, date: 1 } });
    if (other) return NextResponse.json({ error: `${invoiceNumber} is already on another job (${other.clientName ?? "—"}, ${String(other.date ?? "").slice(0, 10)})` }, { status: 409 });
    const r = await db.collection("Job").updateOne(
      { _id: new ObjectId(jobId), $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }, { invoiceNumber: "" }] },
      { $set: { invoiceNumber, invoiceLinkedBy: `confirmed:${s.name}`, invoiceLinkedAt: now, invoiceLinkTeam: sug.team } },
    );
    if (!r.modifiedCount) return NextResponse.json({ error: "That job already has an invoice number" }, { status: 409 });
    await S.updateOne({ _id: invoiceNumber } as never, { $set: { status: "linked", linkedJobId: jobId, decidedBy: s.name, updated_at: now } } as never);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
