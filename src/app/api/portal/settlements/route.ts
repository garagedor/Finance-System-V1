import { makeCrud } from "../crud-helper";
import type { SettlementRecord } from "@/types/finance";

const crud = makeCrud<SettlementRecord>({
  collection: "settlement",
  idPrefix: "set",
  auditKind: "settlement",
  sort: { date: -1 },
  normalize: (body) => ({
    date: String(body.date ?? new Date().toISOString().slice(0, 10)),
    from_party_id: String(body.from_party_id ?? ""),
    from_party_name: String(body.from_party_name ?? ""),
    to_party_id: String(body.to_party_id ?? ""),
    to_party_name: String(body.to_party_name ?? ""),
    amount: Number(body.amount ?? 0),
    payment_method: body.payment_method ?? null,
    reference: body.reference ?? null,
    related_debt_ids: Array.isArray(body.related_debt_ids) ? body.related_debt_ids : [],
    related_payout_id: body.related_payout_id ?? null,
    notes: body.notes ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
