import { makeCrud } from "../crud-helper";
import type { PayoutRecord, PayoutLineItem } from "@/types/finance";
import type { Filter } from "mongodb";

function computeTotals(items: PayoutLineItem[]): {
  gross: number;
  deductions: number;
  net: number;
} {
  let gross = 0;
  let deductions = 0;
  for (const i of items) {
    if (i.amount >= 0) gross += i.amount;
    else deductions += i.amount;
  }
  return { gross, deductions: Math.abs(deductions), net: gross + deductions };
}

const crud = makeCrud<PayoutRecord>({
  collection: "payout",
  idPrefix: "pay",
  sort: { period_end: -1, _id: -1 },
  buildFilter: (sp) => {
    const f: Filter<PayoutRecord> = {};
    const recipient = sp.get("recipient_id");
    if (recipient) f.recipient_id = recipient;
    const status = sp.get("status");
    if (status === "paid" || status === "unpaid") f.status = status;
    return f;
  },
  normalize: (body) => {
    const items = Array.isArray(body.line_items) ? (body.line_items as PayoutLineItem[]) : [];
    const totals = computeTotals(items);
    return {
      recipient_id: String(body.recipient_id ?? ""),
      recipient_name: String(body.recipient_name ?? ""),
      recipient_role: body.recipient_role ?? null,
      profile_id: body.profile_id ?? null,
      period_start: String(body.period_start ?? new Date().toISOString().slice(0, 10)),
      period_end: String(body.period_end ?? new Date().toISOString().slice(0, 10)),
      line_items: items,
      gross: totals.gross,
      deductions: totals.deductions,
      net: totals.net,
      status: body.status === "paid" ? "paid" : "unpaid",
      payment_method: body.payment_method ?? null,
      paid_at: body.paid_at ?? null,
      notes: body.notes ?? null,
      ledger_id: body.ledger_id ? String(body.ledger_id) : null,
    };
  },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
