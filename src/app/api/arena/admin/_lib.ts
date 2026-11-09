// Shared plumbing for /api/arena/admin/*. Every handler goes through
// `arenaRoute`, which checks the CRM session and one Arena permission before
// any Arena code runs, and maps Arena errors to HTTP answers. Owner-only
// actions are enforced again inside the Arena store against the owner id in
// the settings, so a permission alone never grants them.
import "server-only";
import { NextResponse } from "next/server";
import { requirePermission, type RbacSession } from "@/lib/rbac";
import type { Permission } from "@/types/rbac";
import { ArenaAuthorizationError, ArenaStateError } from "@/lib/arena/config-store";
import { ArenaConfigError } from "@/lib/arena/config";
import { ArenaEnvError } from "@/lib/arena/env";
import { arenaContexts, type ArenaContexts } from "@/lib/arena/admin-service";

export type ArenaPermission = "arena:console:view" | "arena:rules:edit" | "arena:review:edit";

export interface ArenaCall {
  session: RbacSession & { userId: string };
  ctx: ArenaContexts;
}

export async function arenaRoute(perm: ArenaPermission, fn: (c: ArenaCall) => Promise<unknown>): Promise<NextResponse> {
  const s = await requirePermission(perm as Permission);
  if (s instanceof NextResponse) return s;
  // Owner checks compare account ids, so an account without one cannot act.
  if (!s.userId) return NextResponse.json({ error: "This session has no account id; sign in again" }, { status: 401 });
  try {
    const ctx = await arenaContexts();
    const out = await fn({ session: s as ArenaCall["session"], ctx });
    return out instanceof NextResponse ? out : NextResponse.json(out ?? { ok: true });
  } catch (e) {
    return arenaError(e);
  }
}

export function arenaError(e: unknown): NextResponse {
  if (e instanceof ArenaAuthorizationError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof ArenaStateError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof ArenaConfigError) return NextResponse.json({ error: "Check the highlighted rules", problems: e.problems }, { status: 400 });
  if (e instanceof ArenaEnvError) return NextResponse.json({ error: "The Arena database is not configured here" }, { status: 503 });
  if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error("[arena] unexpected error:", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export class BadRequest extends Error {}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    return b as Record<string, unknown>;
  } catch {
    throw new BadRequest("The request body must be a JSON object");
  }
}

export const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new BadRequest(`${name} is required`);
  return v.trim();
};
