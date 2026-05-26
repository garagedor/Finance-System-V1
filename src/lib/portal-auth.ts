// Helper for finance portal API routes — reads the session cookie, verifies
// the JWT, returns the user's name + type. Mirrors what the CRM does in
// /api/users/route.ts. Importantly: this DOES verify the JWT, unlike the
// global middleware which only checks for cookie presence.

import { jwtVerify } from "jose";
import { cookies } from "next/headers";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "super-secret-key-for-development"
);

const ALLOWED = new Set(["admin", "office", "bookkeeper"]);

export interface PortalSession {
  name: string;
  type: string;
}

/** Returns the verified session, or null if the user isn't allowed. */
export async function readPortalSession(): Promise<PortalSession | null> {
  try {
    const c = await cookies();
    const token = c.get("session")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const type = (payload as { type?: string }).type;
    const name = (payload as { name?: string }).name ?? "unknown";
    if (!type || !ALLOWED.has(type)) return null;
    return { name, type };
  } catch {
    return null;
  }
}
