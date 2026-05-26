import { makeCrud } from "../crud-helper";
import type { PositionRecord } from "@/types/finance";

const crud = makeCrud<PositionRecord>({
  collection: "position",
  idPrefix: "pos",
  sort: { name: 1 },
  normalize: (body) => ({
    name: String(body.name ?? ""),
    role: String(body.role ?? ""),
    profile_id: body.profile_id ?? null,
    area: body.area ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    active: body.active !== false,
    notes: body.notes ?? null,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
