import "server-only";
import type { ToolContext, ToolDef } from "../types";
import { FINANCE_TOOLS } from "./finance";

// The full read-only tool catalog. Adding a module later = adding its tools
// here; the engine and every executive persona pick them up automatically.
export const ALL_TOOLS: ToolDef[] = [...FINANCE_TOOLS];

export const ALL_TOOL_NAMES: string[] = ALL_TOOLS.map((t) => t.name);

/** Tools a persona is allowed to use AND the session is permitted to run. */
export function toolsFor(allow: string[], ctx: ToolContext): ToolDef[] {
  const set = new Set(allow);
  const isAdmin = ctx.session.type === "admin";
  const perms = new Set(ctx.session.permissions);
  return ALL_TOOLS.filter(
    (t) => set.has(t.name) && (!t.permission || isAdmin || perms.has(t.permission)),
  );
}
