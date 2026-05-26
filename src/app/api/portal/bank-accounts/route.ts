import { makeCrud } from "../crud-helper";
import type { BankAccountRecord } from "@/types/finance";

const crud = makeCrud<BankAccountRecord>({
  collection: "bankAccount",
  idPrefix: "bank",
  sort: { label: 1 },
  normalize: (body) => ({
    label: String(body.label ?? ""),
    bank_name: body.bank_name ?? null,
    account_type: body.account_type ?? "checking",
    last4: body.last4 ?? null,
    starting_balance: body.starting_balance !== undefined ? Number(body.starting_balance) : 0,
    currency: body.currency ?? "USD",
    active: body.active !== false,
    notes: body.notes ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
