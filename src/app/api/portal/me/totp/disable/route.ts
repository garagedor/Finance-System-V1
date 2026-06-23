// Disable 2FA — the user must supply a current TOTP code (or backup code)
// to prove they still have access. Admins can override via the user-admin
// page (separate flow, not this route).

import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { getDb } from "@/lib/finance-db";
import { verifyCode } from "@/lib/totp";
import { userIdFilter } from "@/lib/user-id";
import { audit } from "@/lib/audit";
import bcrypt from "bcryptjs";
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
  if (!u || !u.totp_enabled || !u.totp_secret) {
    return NextResponse.json({ error: "2FA not enabled" }, { status: 400 });
  }

  // Try TOTP code first.
  let ok = false;
  let usedBackup = false;
  const step = verifyCode({ secret: u.totp_secret, code });
  if (step !== null) {
    ok = true;
  } else if (u.totp_backup_codes && u.totp_backup_codes.length > 0) {
    // Try backup codes.
    for (let i = 0; i < u.totp_backup_codes.length; i++) {
      if (await bcrypt.compare(code, u.totp_backup_codes[i])) {
        ok = true;
        usedBackup = true;
        break;
      }
    }
  }
  if (!ok) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await users.updateOne(userIdFilter<User>(session.userId), {
    $set: {
      totp_enabled: false,
      totp_secret: undefined,
      totp_backup_codes: undefined,
      totp_last_step: undefined,
      updated_at: new Date().toISOString(),
    },
  });
  await audit({
    kind: "auth",
    target_id: session.userId,
    before: { totp_enabled: true },
    after: { totp_enabled: false },
    summary: `Disabled 2FA for "${u.name}"${usedBackup ? " (via backup code)" : ""}`,
    changed_by: session.name,
    action: "totp_disabled",
  });
  return NextResponse.json({ ok: true });
}
