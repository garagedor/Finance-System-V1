import { makeCrud } from "../crud-helper";
import type { DebtRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<DebtRecord>({
  collection: "debt",
  idPrefix: "debt",
  sort: { created_at: -1 },
  buildFilter: (sp) => {
    const f: Filter<DebtRecord> = {};
    const status = sp.get("status");
    if (status === "open" || status === "settled" || status === "deducted") f.status = status;
    const partyId = sp.get("party_id");
    if (partyId)
      Object.assign(f, { $or: [{ from_party_id: partyId }, { to_party_id: partyId }] });
    return f;
  },
  normalize: (body) => ({
    from_party_id: String(body.from_party_id ?? ""),
    from_party_name: String(body.from_party_name ?? ""),
    from_party_role: body.from_party_role ?? null,
    to_party_id: String(body.to_party_id ?? ""),
    to_party_name: String(body.to_party_name ?? ""),
    to_party_role: body.to_party_role ?? null,
    amount: Number(body.amount ?? 0),
    reason: body.reason ?? null,
    related_job_id: body.related_job_id ?? null,
    related_report_id: body.related_report_id ?? null,
    related_expense_id: body.related_expense_id ?? null,
    due_date: body.due_date ?? null,
    deduct_from_payout: !!body.deduct_from_payout,
    attachment_url: body.attachment_url ?? null,
    notes: body.notes ?? null,
    status: ["open", "settled", "deducted"].includes(String(body.status)) ? body.status : "open",
    settled_at: body.settled_at ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
