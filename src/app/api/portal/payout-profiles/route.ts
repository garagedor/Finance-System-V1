import { makeCrud } from "../crud-helper";
import type { PayoutProfile } from "@/types/finance";

const crud = makeCrud<PayoutProfile>({
  collection: "payoutProfile",
  idPrefix: "prof",
  sort: { name: 1 },
  normalize: (body) => ({
    name: String(body.name ?? ""),
    description: body.description ?? null,
    applies_to_role: body.applies_to_role ?? null,
    components: Array.isArray(body.components) ? body.components : [],
    active: body.active !== false,
  }),
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
