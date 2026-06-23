import { makeCrud } from "../crud-helper";
import type { EquipmentRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<EquipmentRecord>({
  collection: "equipment",
  idPrefix: "eq",
  sort: { date: -1 },
  buildFilter: (sp) => {
    const f: Filter<EquipmentRecord> = {};
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) f.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const type = sp.get("type");
    if (type) f.type = type as EquipmentRecord["type"];
    return f;
  },
  normalize: (body) => {
    const amount = Number(body.amount ?? 0);
    const paid = Number(body.paid_amount ?? 0);
    return {
      date: String(body.date ?? new Date().toISOString().slice(0, 10)),
      type: body.type ?? "purchase",
      description: String(body.description ?? ""),
      sku: body.sku ?? null,
      qty: body.qty !== undefined ? Number(body.qty) : null,
      unit_cost: body.unit_cost !== undefined ? Number(body.unit_cost) : null,
      unit_price: body.unit_price !== undefined ? Number(body.unit_price) : null,
      amount,
      profit: body.profit !== undefined ? Number(body.profit) : null,
      counterparty_id: body.counterparty_id ?? null,
      counterparty_name: body.counterparty_name ?? null,
      related_area: body.related_area ?? null,
      paid_amount: paid,
      open_amount: Math.max(0, Math.abs(amount) - paid),
      status: body.status === "paid" ? "paid" : "unpaid",
      notes: body.notes ?? null,
    };
  },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
