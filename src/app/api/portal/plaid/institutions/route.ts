// List connected institutions (no access tokens exposed).
// DELETE removes one — does NOT call Plaid /item/remove because that's
// optional and slows the UX; we just mark disconnected locally. To fully
// revoke at Plaid, set ?revoke=1 (requires server roundtrip).

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type {
  BankAccountSyncedRecord,
  ConnectedInstitutionRecord,
} from "@/types/finance-plaid";
import { isPlaidConfigured, plaid } from "@/lib/plaid";
import { decrypt } from "@/lib/portal-crypto";

export async function GET() {
  const session = await requirePermission("finance:banking:view");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();

  const institutions = await coll<ConnectedInstitutionRecord>(FINANCE_COLLECTIONS.plaidInstitution)
    .find({})
    .sort({ connected_at: -1 })
    .toArray();
  const accounts = await coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced)
    .find({})
    .toArray();

  // Strip the access_token before returning
  const safe = institutions.map(({ access_token_enc, ...rest }) => {
    const accountsForItem = accounts.filter((a) => a.item_id === rest.item_id);
    void access_token_enc;
    return { ...rest, accounts: accountsForItem };
  });

  return NextResponse.json({ rows: safe });
}

export async function DELETE(req: NextRequest) {
  const session = await requirePermission("finance:banking:disconnect");
  if (session instanceof NextResponse) return session;
  const sp = req.nextUrl.searchParams;
  const itemId = sp.get("item_id");
  const revoke = sp.get("revoke") === "1";
  if (!itemId) return NextResponse.json({ error: "item_id required" }, { status: 400 });

  await ensureFinanceIndexes();
  const institutionsColl = coll<ConnectedInstitutionRecord>(FINANCE_COLLECTIONS.plaidInstitution);
  const inst = await institutionsColl.findOne({ item_id: itemId });
  if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Optionally call Plaid /item/remove to revoke the token server-side
  if (revoke && isPlaidConfigured()) {
    try {
      const accessToken = decrypt(inst.access_token_enc);
      await plaid().itemRemove({ access_token: accessToken });
    } catch {
      // non-fatal — we still mark disconnected locally
    }
  }

  // Mark disconnected (preserve audit) and wipe the encrypted token
  await institutionsColl.updateOne(
    { item_id: itemId },
    {
      $set: {
        status: "disconnected",
        status_message: revoke ? "Revoked at Plaid + disconnected" : "Disconnected locally",
        access_token_enc: "",
      },
    }
  );

  // Deactivate associated accounts so they don't pollute the active list
  await coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced).updateMany(
    { item_id: itemId },
    { $set: { active: false, status: "disconnected" } }
  );

  return NextResponse.json({ ok: true });
}
