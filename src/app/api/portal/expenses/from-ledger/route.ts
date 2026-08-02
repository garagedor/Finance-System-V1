// Ledger-sourced expense: create/edit/delete a company expense that is linked
// to an area-manager / technician ledger (we paid them). Each mutation keeps
// the matching (positive) ledger entry in sync. See lib/ledger-link.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { audit } from "@/lib/audit";
import type { ExpenseRecord, ExpenseCategory } from "@/types/finance";
import type { LedgerRecord } from "@/types/finance-ledger";
import {
  postLinkedLedgerEntry,
  resyncLinkedLedgerEntry,
  reverseLinkedLedgerEntry,
} from "@/lib/ledger-link";

const today = () => new Date().toISOString().slice(0, 10);
const asCategory = (v: unknown): ExpenseCategory => (v ? String(v) : "misc") as ExpenseCategory;

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

    const expense: ExpenseRecord = {
      _id: newId("exp"),
      category: asCategory(body.category),
      amount,
      date: String(body.date ?? today()),
      description: String(body.description ?? "").trim() || `Paid ${ledger.holder_name}`,
      vendor_name: ledger.holder_name,
      related_area: body.related_area ? String(body.related_area) : ledger.location,
      payment_method: (body.payment_method as ExpenseRecord["payment_method"]) ?? undefined,
      notes: body.notes ? String(body.notes) : undefined,
      status: body.status === "unpaid" ? "unpaid" : "paid", // we paid them
      ledger_id: ledgerId,
      ledger_holder: ledger.holder_name,
      created_at: new Date().toISOString(),
      created_by: session.name,
    };

    const eColl = coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
    await eColl.insertOne(expense);

    const entryId = await postLinkedLedgerEntry({
      ledgerId, kind: "expense", refId: expense._id,
      amount: expense.amount, date: expense.date, description: expense.description, actor: session.name,
    });
    await eColl.updateOne({ _id: expense._id }, { $set: { ledger_entry_id: entryId } });
    expense.ledger_entry_id = entryId;

    await audit({
      kind: "expense",
      target_id: expense._id,
      before: null,
      after: expense,
      summary: `Created expense $${amount.toLocaleString()} paid to ${ledger.holder_name} (${ledger.location})`,
      changed_by: session.name,
    });

    return NextResponse.json({ row: expense }, { status: 201 });
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

    const eColl = coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
    const before = await eColl.findOne({ _id: id });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const amount = body.amount !== undefined ? Math.abs(Number(body.amount)) : before.amount;
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 });
    }
    const patch: Partial<ExpenseRecord> = {
      amount,
      date: body.date ? String(body.date) : before.date,
      description: body.description !== undefined ? String(body.description).trim() : before.description,
      category: body.category !== undefined ? asCategory(body.category) : before.category,
      payment_method: (body.payment_method as ExpenseRecord["payment_method"]) ?? before.payment_method,
      related_area: body.related_area !== undefined ? String(body.related_area) : before.related_area,
      notes: body.notes !== undefined ? (body.notes ? String(body.notes) : undefined) : before.notes,
      status: body.status === "unpaid" ? "unpaid" : body.status === "paid" ? "paid" : before.status,
    };

    await eColl.updateOne(
      { _id: id },
      { $set: { ...patch, updated_at: new Date().toISOString(), updated_by: session.name } },
    );

    if (before.ledger_entry_id) {
      await resyncLinkedLedgerEntry(before.ledger_entry_id, "expense", {
        amount,
        date: patch.date!,
        description: patch.description,
      });
    }

    await audit({
      kind: "expense",
      target_id: id,
      before,
      after: { ...before, ...patch },
      summary: `Updated ledger expense "${patch.description ?? id}" → $${amount.toLocaleString()}`,
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

    const eColl = coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
    const before = await eColl.findOne({ _id: id });
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (before.ledger_entry_id) {
      await reverseLinkedLedgerEntry(before.ledger_entry_id, session.name);
    }
    await eColl.deleteOne({ _id: id });

    await audit({
      kind: "expense",
      target_id: id,
      before,
      after: null,
      summary: `Deleted ledger expense "${before.description ?? id}" — ledger entry reversed`,
      changed_by: session.name,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Delete failed" }, { status: 400 });
  }
}
