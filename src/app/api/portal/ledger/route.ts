import { makeCrud } from "../crud-helper";
import type { LedgerRecord } from "@/types/finance-ledger";
import type { Filter } from "mongodb";

// The two roles with code dependencies keep their canonical slugs; any other
// role (predefined or user-created) is stored as typed.
function normalizeRole(v: unknown): string {
  const raw = String(v ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower === "area manager" || lower === "area_manager") return "area_manager";
  if (lower === "technician" || lower === "tech") return "technician";
  return raw || "area_manager";
}

const crud = makeCrud<LedgerRecord>({
  collection: "ledger",
  idPrefix: "ldg",
  sort: { holder_name: 1 },
  buildFilter: (sp) => {
    const f: Filter<LedgerRecord> = {};
    const role = sp.get("role");
    if (role) f.role = role;
    const location = sp.get("location");
    if (location) f.location = location;
    const status = sp.get("status");
    if (status === "active" || status === "archived") f.status = status;
    return f;
  },
  normalize: (body) => ({
    holder_name: String(body.holder_name ?? "").trim(),
    role: normalizeRole(body.role),
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
