import { makeCrud } from "../crud-helper";
import type { RefundRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<RefundRecord>({
  collection: "refund",
  idPrefix: "ref",
  auditKind: "refund",
  sort: { date: -1, _id: -1 },
  buildFilter: (sp) => {
    const f: Filter<RefundRecord> = {};
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) f.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    return f;
  },
  normalize: (body) => ({
    customer_name: body.customer_name ?? null,
    address: body.address ?? null,
    job_id: body.job_id ?? null,
    tech_id: body.tech_id ?? null,
    tech_name: body.tech_name ?? null,
    area: body.area ?? null,
    provider_id: body.provider_id ?? null,
    provider_name: body.provider_name ?? null,
    date: String(body.date ?? new Date().toISOString().slice(0, 10)),
    amount: Number(body.amount ?? 0),
    reason: body.reason ?? null,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    notes: body.notes ?? null,
    status: body.status === "paid" ? "paid" : "unpaid",
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
