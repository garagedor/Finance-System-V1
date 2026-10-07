/**
 * Browser entry to Warehouse.
 *
 * A top-level navigation cannot carry an Authorization header, so same-origin
 * entry needs a cookie. This route is the only place one is set: it requires a
 * live CRM session, requires canonical Warehouse entitlement, mints the same
 * RS256 token the JSON door issues, and hands it over scoped to /warehouse.
 *
 * `Path=/warehouse` is the point of the cookie, not a detail of it: the
 * Warehouse token is never sent on a CRM request.
 *
 * It never redirects to /warehouse without having set a cookie. That is what
 * makes a redirect loop impossible — a refused caller is told so here and goes
 * no further.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readSession } from "@/lib/rbac";
import { WAREHOUSE_TOKEN_COOKIE, mintWarehouseToken } from "@/lib/warehouse-mint";

export const dynamic = "force-dynamic";

/** Only same-origin warehouse paths, so this cannot be used as an open redirect. */
function safeNext(raw: string | null): string {
  if (!raw) return "/warehouse";
  // No scheme, no protocol-relative, no traversal out of the prefix.
  if (!raw.startsWith("/warehouse")) return "/warehouse";
  if (raw.startsWith("//") || raw.includes("..")) return "/warehouse";
  return raw;
}

export async function GET(request: NextRequest) {
  const minted = await mintWarehouseToken(await readSession());

  if (!minted.ok) {
    const status = minted.status;
    const body =
      minted.reason === "no_session"
        ? { error: "Unauthorized", detail: "Sign in to the 317 Eco System first." }
        : { error: minted.reason, detail: minted.detail };
    // Deliberately not a redirect to /warehouse: a refusal that bounced the
    // browser onward is how a redirect loop starts.
    return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  }

  const destination = safeNext(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(destination, request.nextUrl.origin), 302);
  response.cookies.set(WAREHOUSE_TOKEN_COOKIE, minted.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/warehouse",
    maxAge: minted.expiresIn,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
