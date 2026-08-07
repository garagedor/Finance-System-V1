// Single payout: edit, mark paid/unpaid, delete. Unlike the makeCrud list-route
// PUT (which rebuilds the whole doc from the body and would wipe fields on a
// partial update), these handlers LOAD the existing payout and merge, then
// reconcile the linked ledger entry via syncPayoutLedger.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { requirePermission } from "@/lib/rbac";
import { syncPayoutLedger, removePayoutLedger } from "@/lib/payout-service";
import type { PayoutRecord, PayoutLineItem } from "@/types/finance";

function computeTotals(items: PayoutLineItem[]) {
  let gross = 0, ded = 0;
  for (const i of items) { if (i.amount >= 0) gross += i.amount; else ded += i.amount; }
  return { gross, deductions: Math.abs(ded), net: gross + ded };
}

async function loadPayout(id: string): Promise<PayoutRecord | null> {
  await ensureFinanceIndexes();
  return coll<PayoutRecord>(FINANCE_COLLECTIONS.payout).findOne({ _id: id });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("finance:payouts:view");
  if (session instanceof NextResponse) return session;
  const { id } = await ctx.params;
  const row = await loadPayout(id);
  if (!row) return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  return NextResponse.json({ row });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("finance:payouts:edit");
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await ctx.params;
    const existing = await loadPayout(id);
    if (!existing) return NextResponse.json({ error: "Payout not found" }, { status: 404 });
    const body = (await req.json()) as Record<string, unknown>;

    const items = Array.isArray(body.line_items) ? (body.line_items as PayoutLineItem[]) : existing.line_items;
    const totals = computeTotals(items);
    const patch = {
      recipient_id: body.recipient_id != null ? String(body.recipient_id) : existing.recipient_id,
      recipient_name: body.recipient_name != null ? String(body.recipient_name) : existing.recipient_name,
      recipient_role: body.recipient_role !== undefined ? (body.recipient_role as string | null) : existing.recipient_role,
      profile_id: body.profile_id !== undefined ? (body.profile_id as string | null) : existing.profile_id,
      period_start: body.period_start != null ? String(body.period_start) : existing.period_start,
      period_end: body.period_end != null ? String(body.period_end) : existing.period_end,
      line_items: items,
      gross: totals.gross,
      deductions: totals.deductions,
      net: totals.net,
      payment_method: body.payment_method !== undefined ? (body.payment_method as PayoutRecord["payment_method"]) : existing.payment_method,
      notes: body.notes !== undefined ? (body.notes as string | null) : existing.notes,
      ledger_id: body.ledger_id !== undefined ? (body.ledger_id ? String(body.ledger_id) : null) : (existing.ledger_id ?? null),
      updated_at: new Date().toISOString(),
      updated_by: session.name,
    };
    await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout).updateOne({ _id: id }, { $set: patch });
    const updated = { ...existing, ...patch } as PayoutRecord;
    await syncPayoutLedger(updated, session.name);
    return NextResponse.json({ ok: true, row: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("finance:payouts:edit");
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await ctx.params;
    const existing = await loadPayout(id);
    if (!existing) return NextResponse.json({ error: "Payout not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { action?: string; date?: string };
    const now = new Date().toISOString();
    const stamp = { updated_at: now, updated_by: session.name };

    let patch: Partial<PayoutRecord>;
    switch (body.action) {
      case "mark_paid":
        // Marking paid NEVER posts to the ledger — that's a separate choice.
        patch = { status: "paid", paid_at: body.date || now.slice(0, 10), paid_by: session.name, ...stamp };
        break;
      case "mark_unpaid":
        patch = { status: "unpaid", paid_at: null, ...stamp };
        break;
      case "post_ledger":
        if (!existing.ledger_id) return NextResponse.json({ error: "Choose a ledger on this payout first." }, { status: 400 });
        if (existing.status !== "paid") return NextResponse.json({ error: "Mark the payout paid before posting it to the ledger." }, { status: 400 });
        patch = { post_to_ledger: true, ...stamp };
        break;
      case "unpost_ledger":
        patch = { post_to_ledger: false, ...stamp };
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout).updateOne({ _id: id }, { $set: patch });
    const updated = { ...existing, ...patch } as PayoutRecord;
    const ledgerEntryId = await syncPayoutLedger(updated, session.name);
    return NextResponse.json({ ok: true, status: updated.status, ledgerEntryId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("finance:payouts:delete");
  if (session instanceof NextResponse) return session;
  const { id } = await ctx.params;
  await ensureFinanceIndexes();
  await removePayoutLedger(id);
  const r = await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout).deleteOne({ _id: id });
  return NextResponse.json({ deletedCount: r.deletedCount });
}
