import { makeCrud } from "../crud-helper";
import type { LedgerRecord } from "@/types/finance-ledger";
import type { Filter } from "mongodb";

const crud = makeCrud<LedgerRecord>({
  collection: "ledger",
  idPrefix: "ldg",
  sort: { holder_name: 1 },
  buildFilter: (sp) => {
    const f: Filter<LedgerRecord> = {};
    const role = sp.get("role");
    if (role === "area_manager" || role === "technician") f.role = role;
    const location = sp.get("location");
    if (location) f.location = location;
    const status = sp.get("status");
    if (status === "active" || status === "archived") f.status = status;
    return f;
  },
  normalize: (body) => ({
    holder_name: String(body.holder_name ?? "").trim(),
    role: body.role === "technician" ? "technician" : "area_manager",
    location: String(body.location ?? "").trim(),
    label: body.label ?? null,
    notes: body.notes ?? null,
    status: body.status === "archived" ? "archived" : "active",
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
