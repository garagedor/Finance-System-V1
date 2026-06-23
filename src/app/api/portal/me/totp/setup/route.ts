// Begin TOTP enrollment for the current session's user. Returns a fresh
// secret + QR. The secret is stored on the user row but `totp_enabled`
// stays false until /confirm is called with a valid code.

import { NextResponse } from "next/server";
import { readSession } from "@/lib/rbac";
import { getDb } from "@/lib/finance-db";
import { newSecret, provisioningUrl, generateBackupCodes } from "@/lib/totp";
import { userIdFilter } from "@/lib/user-id";
import { audit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import type { User } from "@/types/user";

export async function POST() {
  const session = await readSession();
  if (!session || !session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const users = db.collection<User>("users");
  const u = await users.findOne(userIdFilter<User>(session.userId));
  if (!u) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (u.totp_enabled) {
    return NextResponse.json(
      { error: "2FA already enabled. Disable it first to re-enroll." },
      { status: 409 }
    );
  }

  const secret = newSecret();
  const codes = generateBackupCodes(10);
  const codeHashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

  await users.updateOne(userIdFilter<User>(session.userId), {
    $set: {
      totp_secret: secret,
      totp_enabled: false,
      totp_backup_codes: codeHashes,
      updated_at: new Date().toISOString(),
    },
  });

  const { url, qr } = await provisioningUrl({ secret, account: u.name });

  // Return the plain-text backup codes ONCE — user must save them. They're
  // stored hashed; we cannot show them again.
  await audit({
    kind: "auth",
    target_id: session.userId,
    before: { totp_enabled: u.totp_enabled ?? false },
    after: { totp_enabled: false, enrollment_started: true },
    summary: `Started TOTP enrollment for "${u.name}"`,
    changed_by: session.name,
    action: "totp_setup_start",
  });

  return NextResponse.json({ otpauth_url: url, qr_data_url: qr, backup_codes: codes });
}
