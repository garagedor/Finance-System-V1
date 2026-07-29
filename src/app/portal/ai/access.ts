import "server-only";
import { readSession, type RbacSession } from "@/lib/rbac";

// Gate for the AI Workspace. Admins pass automatically (their stored role may
// predate the system:ai:view permission — same seeding gotcha as other perms),
// otherwise the session must hold system:ai:view.
export async function aiSession(): Promise<RbacSession | null> {
  const s = await readSession();
  if (!s || !s.active) return null;
  if (s.type === "admin" || s.permissions.includes("system:ai:view")) return s;
  return null;
}

/** True once an Anthropic key is configured, so the engine can run. */
export function engineReady(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
