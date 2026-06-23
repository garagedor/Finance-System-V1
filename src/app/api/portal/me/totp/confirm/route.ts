// Confirm a TOTP enrollment by submitting a valid 6-digit code. On success,
// totp_enabled flips true and 2FA is required for subsequent logins.

import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { getDb } from "@/lib/finance-db";
import { verifyCode } from "@/lib/totp";
import { userIdFilter } from "@/lib/user-id";
import { audit } from "@/lib/audit";
import type { User } from "@/types/user";

export async function POST(req: NextRequest) {
  const session = await readSession();
  if (!session || !session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = String(body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const db = await getDb();
  const users = db.collection<User>("users");
  const u = await users.findOne(userIdFilter<User>(session.userId));
  if (!u || !u.totp_secret) {
    return NextResponse.json({ error: "Start enrollment first" }, { status: 400 });
  }
  if (u.totp_enabled) {
    return NextResponse.json({ ok: true, already_enabled: true });
  }
  const step = verifyCode({ secret: u.totp_secret, code });
  if (step === null) {
    return NextResponse.json({ error: "Invalid code. Try again." }, { status: 400 });
  }

  await users.updateOne(userIdFilter<User>(session.userId), {
    $set: {
      totp_enabled: true,
      totp_last_step: step,
      updated_at: new Date().toISOString(),
    },
  });
  await audit({
    kind: "auth",
    target_id: session.userId,
    before: { totp_enabled: false },
    after: { totp_enabled: true },
    summary: `Enabled 2FA for "${u.name}"`,
    changed_by: session.name,
    action: "totp_enabled",
  });
  return NextResponse.json({ ok: true });
}
