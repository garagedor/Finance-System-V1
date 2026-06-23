import { makeCrud } from "../crud-helper";
import type { BankTxnRecord } from "@/types/finance";
import type { Filter } from "mongodb";

const crud = makeCrud<BankTxnRecord>({
  collection: "bankTxn",
  idPrefix: "btx",
  sort: { posted_date: -1 },
  buildFilter: (sp) => {
    const f: Filter<BankTxnRecord> = {};
    const account = sp.get("account_id");
    if (account) f.account_id = account;
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to)
      f.posted_date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    return f;
  },
  normalize: (body) => ({
    account_id: String(body.account_id ?? ""),
    posted_date: String(body.posted_date ?? new Date().toISOString().slice(0, 10)),
    amount: Number(body.amount ?? 0),
    description: String(body.description ?? ""),
    type: body.type ?? null,
    payment_method: body.payment_method ?? null,
    matched_to: body.matched_to ?? null,
    notes: body.notes ?? null,
    source: body.source === "import" ? "import" : "manual",
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
