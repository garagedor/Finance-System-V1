// Send a test email to the requesting user. Useful for verifying Resend is
// configured correctly.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { sendEmail, isEmailConfigured } from "@/lib/email";

export async function POST(req: NextRequest) {
  const session = await requirePermission("system:integrations:edit");
  if (session instanceof NextResponse) return session;
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "Email not configured. Set RESEND_API_KEY in .env.local." },
      { status: 503 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as { to?: string };
  const to = body.to?.trim();
  if (!to) return NextResponse.json({ error: "to required" }, { status: 400 });

  const r = await sendEmail({
    to,
    subject: "LBS Finance — test email",
    text: `Hi ${session.name},\n\nThis is a test message from the LBS Finance portal. If you received it, transactional email is wired up correctly.\n\nSent at: ${new Date().toISOString()}\n`,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.reason ?? "send failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: r.id });
}
