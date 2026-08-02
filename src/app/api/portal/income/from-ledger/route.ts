// Ledger-sourced income: create/edit/delete a company income entry that is
// linked to an area-manager / technician ledger. Each mutation keeps the
// matching (negative) ledger entry in sync. See lib/ledger-link.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { audit } from "@/lib/audit";
import type { ManualIncomeRecord, IncomeSource } from "@/types/finance";
import type { LedgerRecord } from "@/types/finance-ledger";
import {
  postLinkedLedgerEntry,
  resyncLinkedLedgerEntry,
  reverseLinkedLedgerEntry,
} from "@/lib/ledger-link";

const VALID_SOURCES: IncomeSource[] = [
  "crm_jobs", "installations", "parts_sales", "card_fee_margin",
  "finance_fee_margin", "company_parts_margin", "manual", "inventory", "other",
];
const asSource = (v: unknown): IncomeSource =>
  VALID_SOURCES.includes(v as IncomeSource) ? (v as IncomeSource) : "other";

const today = () => new Date().toISOString().slice(0, 10);

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const body = (await req.json()) as Record<string, unknown>;

    const ledgerId = String(body.ledger_id ?? "").trim();
    if (!ledgerId) return NextResponse.json({ error: "A ledger is required" }, { status: 400 });
    const ledger = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: ledgerId });
    if (!ledger) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    const amount = Math.abs(Number(body.amount));
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 });
    }

    const income: ManualIncomeRecord = {
      _id: newId("inc"),
      source: asSource(body.source),
      amount,
      date: String(body.date ?? today()),
      description: String(body.description ?? "").trim() || `${ledger.location} office`,
      category: body.category ? String(body.category) : undefined,
      payment_method: (body.payment_method as ManualIncomeRecord["payment_method"]) ?? undefined,
      related_area: body.related_area ? String(body.related_area) : ledger.location,
      notes: body.notes ? String(body.notes) : undefined,
      ledger_id: ledgerId,
      ledger_holder: ledger.holder_name,
      created_at: new Date().toISOString(),
      created_by: session.name,
    };

    const iColl = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
    await iColl.insertOne(income);

    // Post the mirror ledger entry, then record its id back on the income.
    const entryId = await postLinkedLedgerEntry({
      ledgerId, kind: "income", refId: income._id,
      amount: income.amount, date: income.date, description: income.description, actor: session.name,
    });
    await iColl.updateOne({ _id: income._id }, { $set: { ledger_entry_id: entryId } });
    income.ledger_entry_id = entryId;

    await audit({
      kind: "income",
      target_id: income._id,
      before: null,
      after: income,
      summary: `Created income $${amount.toLocaleString()} from ${ledger.holder_name}'s ledger (${ledger.location})`,
      changed_by: session.name,
    });

    return NextResponse.json({ row: income }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Create failed" }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const body = (await req.json()) as Record<string, unknown> & { _id?: string };
    const id = body._id;
    if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });

    const iColl = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
    const before = await iColl.findOne({ _id: id });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const amount = body.amount !== undefined ? Math.abs(Number(body.amount)) : before.amount;
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 });
    }
    const patch: Partial<ManualIncomeRecord> = {
      amount,
      date: body.date ? String(body.date) : before.date,
      description: body.description !== undefined ? String(body.description).trim() : before.description,
      source: body.source !== undefined ? asSource(body.source) : before.source,
      payment_method: (body.payment_method as ManualIncomeRecord["payment_method"]) ?? before.payment_method,
      related_area: body.related_area !== undefined ? String(body.related_area) : before.related_area,
      notes: body.notes !== undefined ? (body.notes ? String(body.notes) : undefined) : before.notes,
    };

    await iColl.updateOne(
      { _id: id },
      { $set: { ...patch, updated_at: new Date().toISOString(), updated_by: session.name } },
    );

    // Keep the mirror ledger entry aligned with the new amount/date/description.
    if (before.ledger_entry_id) {
      await resyncLinkedLedgerEntry(before.ledger_entry_id, "income", {
        amount,
        date: patch.date!,
        description: patch.description,
      });
    }

    await audit({
      kind: "income",
      target_id: id,
      before,
      after: { ...before, ...patch },
      summary: `Updated ledger income "${patch.description ?? id}" → $${amount.toLocaleString()}`,
      changed_by: session.name,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const id = req.nextUrl.searchParams.get("_id");
    if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });

    const iColl = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
    const before = await iColl.findOne({ _id: id });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Reverse the mirror ledger entry first (append-only-safe), then remove the income.
    if (before.ledger_entry_id) {
      await reverseLinkedLedgerEntry(before.ledger_entry_id, session.name);
    }
    await iColl.deleteOne({ _id: id });

    await audit({
      kind: "income",
      target_id: id,
      before,
      after: null,
      summary: `Deleted ledger income "${before.description ?? id}" — ledger entry reversed`,
      changed_by: session.name,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Delete failed" }, { status: 400 });
  }
}
