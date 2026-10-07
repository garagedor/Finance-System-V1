/**
 * Mint a Warehouse token for the signed-in CRM user (JSON door).
 *
 * A valid CRM session is necessary and not sufficient. Warehouse is a separate
 * application with its own entitlement; holding a session here says who you
 * are, not that you belong there.
 *
 * The token is separately signed with RS256. It is not the CRM session cookie
 * with extra claims, and the CRM's own HS256 secret is never involved —
 * Warehouse holds only the public half and so cannot mint anything.
 *
 * Every decision lives in lib/warehouse-mint.ts, shared with the browser entry
 * route so the two doors cannot issue different contracts.
 */
import { NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { mintWarehouseToken } from "@/lib/warehouse-mint";

export const dynamic = "force-dynamic";

export async function POST() {
  const minted = await mintWarehouseToken(await readSession());

  if (!minted.ok) {
    if (minted.reason === "no_session") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (minted.reason === "not_configured") {
      // Fail closed, and say which half is missing without saying anything
      // about its contents. 503 rather than 500: the request was fine, the
      // deployment is not configured to answer it yet.
      return NextResponse.json({ error: "not_configured", detail: minted.detail }, { status: 503 });
    }
    return NextResponse.json({ error: "Forbidden", detail: minted.detail }, { status: 403 });
  }

  return NextResponse.json(
    { token: minted.token, expiresIn: minted.expiresIn },
    { headers: { "cache-control": "no-store" } },
  );
}
