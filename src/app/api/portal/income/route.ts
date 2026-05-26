import { makeCrud } from "../crud-helper";
import type { ManualIncomeRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<ManualIncomeRecord>({
  collection: "income",
  idPrefix: "inc",
  sort: { date: -1, _id: -1 },
  buildFilter: (sp) => {
    const f: Filter<ManualIncomeRecord> = {};
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) f.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const source = sp.get("source");
    if (source) f.source = source as ManualIncomeRecord["source"];
    return f;
  },
  normalize: (body) => ({
    source: String(body.source ?? "manual"),
    amount: Number(body.amount ?? 0),
    date: String(body.date ?? new Date().toISOString().slice(0, 10)),
    description: String(body.description ?? ""),
    category: body.category ?? null,
    payment_method: body.payment_method ?? null,
    related_area: body.related_area ?? null,
    related_person_id: body.related_person_id ?? null,
    notes: body.notes ?? null,
    attachment_url: body.attachment_url ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
