// Manual ledger entries. Append-only: POST adds one balance movement to a
// ledger. Reports (source: "crm") are added by a separate route in Phase 2.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import {
  type LedgerEntryRecord,
  type LedgerEntryType,
  type LedgerRecord,
} from "@/types/finance-ledger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    await ensureFinanceIndexes();

    const ledger = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: id });
    if (!ledger) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    const body = (await req.json()) as Record<string, unknown>;

    // Accept a known type OR a custom hand-typed one (trimmed, capped). Never
    // allow the reserved CRM-auto "report" type on a manual entry.
    const rawType = typeof body.type === "string" ? body.type.trim().slice(0, 40) : "";
    const type: LedgerEntryType = !rawType || rawType === "report" ? "adjustment" : rawType;

    const gross = body.gross_amount != null ? Number(body.gross_amount) : null;
    const pct = body.pct_applied != null ? Number(body.pct_applied) : null; // fraction 0–1

    // Dispute / refund: the technician owes the company their share of the
    // loss = gross × their %. Positive movement (they owe the company). The
    // share is authoritative — computed here, not trusted from the client.
    let amount: number;
    if ((type === "dispute" || type === "refund") && gross != null && pct != null) {
      if (!Number.isFinite(gross) || !Number.isFinite(pct)) {
        return NextResponse.json({ error: "Gross and % must be numbers" }, { status: 400 });
      }
      amount = Math.round(gross * pct * 100) / 100;
    } else {
      amount = Number(body.amount);
    }
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: "Amount must be a number" }, { status: 400 });
    }

    const doc: LedgerEntryRecord = {
      _id: newId("len"),
      ledger_id: id,
      type,
      date: String(body.date ?? new Date().toISOString().slice(0, 10)),
      amount,
      description: body.description ? String(body.description) : null,
      job_ref: body.job_ref ? String(body.job_ref) : null,
      technician_id: body.technician_id ? String(body.technician_id) : null,
      gross_amount: gross != null && Number.isFinite(gross) ? gross : null,
      pct_applied: pct != null && Number.isFinite(pct) ? pct : null,
      bank_txn_id: body.bank_txn_id ? String(body.bank_txn_id) : null,
      payout_id: body.payout_id ? String(body.payout_id) : null,
      reverses_id: null,
      source: "manual",
      created_at: new Date().toISOString(),
      created_by: session.name,
    };

    await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).insertOne(doc);
    return NextResponse.json({ row: doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to add entry" },
      { status: 400 },
    );
  }
}

// Edit an existing MANUAL entry (date / type / amount / description). System &
// linked entries (source "crm"/"imported", CRM reports, reversals, or an entry
// that has already been reversed) are append-only and rejected — correct those
// with a reversing entry instead, so the source records never desync.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    await ensureFinanceIndexes();
    const body = (await req.json()) as Record<string, unknown> & { _id?: string };
    const entryId = body._id;
    if (!entryId) return NextResponse.json({ error: "_id required" }, { status: 400 });

    const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
    const entry = await ec.findOne({ _id: entryId, ledger_id: id });
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    if (entry.source !== "manual") {
      return NextResponse.json({ error: "Only manually-added entries can be edited. Reverse system entries instead." }, { status: 400 });
    }
    if (entry.reverses_id) {
      return NextResponse.json({ error: "A reversal entry can't be edited." }, { status: 400 });
    }
    const reversedBy = await ec.findOne({ reverses_id: entryId });
    if (reversedBy) {
      return NextResponse.json({ error: "This entry was reversed and can't be edited." }, { status: 400 });
    }

    const rawType = typeof body.type === "string" ? body.type.trim().slice(0, 40) : "";
    const type: LedgerEntryType = !rawType || rawType === "report" ? "adjustment" : rawType;
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: "Amount must be a number" }, { status: 400 });
    }

    const patch = {
      type,
      amount,
      date: String(body.date ?? entry.date),
      description: body.description ? String(body.description) : null,
      updated_at: new Date().toISOString(),
      updated_by: session.name,
    };
    await ec.updateOne({ _id: entryId }, { $set: patch });
    return NextResponse.json({ ok: true, row: { ...entry, ...patch } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to edit entry" },
      { status: 400 },
    );
  }
}
