import { makeCrud } from "../crud-helper";
import type { ExpenseRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<ExpenseRecord>({
  collection: "expense",
  idPrefix: "exp",
  auditKind: "expense",
  sort: { date: -1, _id: -1 },
  buildFilter: (sp) => {
    const f: Filter<ExpenseRecord> = {};
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) f.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const cat = sp.get("category");
    if (cat) f.category = cat as ExpenseRecord["category"];
    const status = sp.get("status");
    if (status === "paid" || status === "unpaid") f.status = status;
    return f;
  },
  normalize: (body) => ({
    category: String(body.category ?? "misc"),
    amount: Number(body.amount ?? 0),
    date: String(body.date ?? new Date().toISOString().slice(0, 10)),
    vendor_name: body.vendor_name ?? null,
    vendor_id: body.vendor_id ?? null,
    related_person_id: body.related_person_id ?? null,
    related_area: body.related_area ?? null,
    payment_method: body.payment_method ?? null,
    receipt_url: body.receipt_url ?? null,
    notes: body.notes ?? null,
    description: body.description ?? null,
    status: body.status === "paid" ? "paid" : "unpaid",
    paid_at: body.paid_at ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
