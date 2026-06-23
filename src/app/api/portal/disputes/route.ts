import { makeCrud } from "../crud-helper";
import type { DisputeRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<DisputeRecord>({
  collection: "dispute",
  idPrefix: "disp",
  auditKind: "dispute",
  sort: { date: -1, _id: -1 },
  buildFilter: (sp) => {
    const f: Filter<DisputeRecord> = {};
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) f.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const status = sp.get("status");
    if (status === "open" || status === "won" || status === "lost" || status === "partial") f.status = status;
    return f;
  },
  normalize: (body) => {
    const disputed = Number(body.amount_disputed ?? 0);
    const recovered = body.amount_recovered !== undefined ? Number(body.amount_recovered) : 0;
    return {
      customer_name: body.customer_name ?? null,
      address: body.address ?? null,
      job_id: body.job_id ?? null,
      tech_id: body.tech_id ?? null,
      tech_name: body.tech_name ?? null,
      area: body.area ?? null,
      provider_id: body.provider_id ?? null,
      provider_name: body.provider_name ?? null,
      date: String(body.date ?? new Date().toISOString().slice(0, 10)),
      amount_disputed: disputed,
      amount_recovered: recovered,
      amount_open: Math.max(0, disputed - recovered),
      status: ["open", "won", "lost", "partial"].includes(String(body.status)) ? body.status : "open",
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      notes: body.notes ?? null,
      paid_unpaid_impact: body.paid_unpaid_impact ?? null,
    };
  },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
