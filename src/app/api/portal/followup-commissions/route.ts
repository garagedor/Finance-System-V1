// Follow-up commissions — a manual layer on top of a CRM job that lets
// management assign a follow-up payment (fixed / % / manual) to a person.
// Created here, later attached to a payout via paid_via_payout_id.

import { makeCrud } from "../crud-helper";
import type { FollowUpCommission } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<FollowUpCommission>({
  collection: "followUpComm",
  idPrefix: "fup",
  sort: { created_at: -1 },
  buildFilter: (sp) => {
    const f: Filter<FollowUpCommission> = {};
    const recipient = sp.get("recipient_id");
    if (recipient) f.recipient_id = recipient;
    const jobId = sp.get("job_id");
    if (jobId) f.job_id = jobId;
    const unattached = sp.get("unattached");
    if (unattached === "1") f.paid_via_payout_id = { $exists: false } as never;
    return f;
  },
  normalize: (body) => ({
    job_id: String(body.job_id ?? ""),
    job_snapshot: body.job_snapshot ?? {},
    recipient_id: String(body.recipient_id ?? ""),
    recipient_name: String(body.recipient_name ?? ""),
    recipient_role: body.recipient_role ?? null,
    kind: body.kind ?? "manual",
    amount: body.amount !== undefined && body.amount !== null ? Number(body.amount) : null,
    rate: body.rate !== undefined && body.rate !== null ? Number(body.rate) : null,
    computed_amount: Number(body.computed_amount ?? 0),
    paid_via_payout_id: body.paid_via_payout_id ?? null,
    notes: body.notes ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
