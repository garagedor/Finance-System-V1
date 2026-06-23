// Transactional email via Resend. Single send() helper so the rest of the
// codebase doesn't care which provider we use. Each notification kind has
// a small render fn that returns plain-text + HTML and the recipient pulls
// from the user record's `email` field. Recipient prefs are consulted
// before sending; if no email configured or user opted out, the call is a
// no-op so callers can fire-and-forget.

import "server-only";
import { Resend } from "resend";
import { getDb } from "./finance-db";
import type { User } from "@/types/user";

export type NotificationKind =
  | "payout_ready"
  | "weekly_summary"
  | "recurring_generated"
  | "large_unmatched_txn"
  | "security_event"
  | "test";

const FROM = process.env.RESEND_FROM ?? "LBS Finance <onboarding@resend.dev>";

function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Send a single email. Returns { ok, skipped, reason } so caller can log. */
export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; skipped?: boolean; reason?: string; id?: string }> {
  const client = resend();
  if (!client) {
    return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  }
  try {
    const r = await client.emails.send({
      from: FROM,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html ?? `<pre style="font-family:ui-monospace,SF Mono,monospace">${escapeHtml(args.text)}</pre>`,
    });
    if (r.error) return { ok: false, reason: r.error.message };
    return { ok: true, id: r.data?.id };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Send a notification to one user (looks up their email + prefs). */
export async function notifyUser(args: {
  userId: string;
  username?: string;
  kind: NotificationKind;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  const db = await getDb();
  const u = await db
    .collection<User>("users")
    .findOne({ _id: args.userId } as never);
  if (!u) return { ok: false, skipped: true, reason: "user not found" };
  if (u.active === false) return { ok: false, skipped: true, reason: "user inactive" };
  const email = (u as User & { email?: string }).email;
  if (!email) return { ok: false, skipped: true, reason: "user has no email" };

  // Check per-user notification prefs (default: enabled for everything).
  const prefs = (u as User & { notification_prefs?: Record<string, boolean> }).notification_prefs ?? {};
  if (prefs[args.kind] === false) {
    return { ok: false, skipped: true, reason: "user opted out of this kind" };
  }

  return sendEmail({ to: email, subject: args.subject, text: args.text, html: args.html });
}

/** Broadcast to every user that holds a given permission. */
export async function notifyByPermission(args: {
  permission: string;
  kind: NotificationKind;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ sent: number; skipped: number; total: number }> {
  const db = await getDb();
  const users = await db
    .collection<User>("users")
    .find({ $or: [{ active: { $exists: false } }, { active: true }] })
    .toArray();

  // Cheap path: assume permission means active + has the perm in role.
  // We don't compute the full effective perm set here; the caller can pass a
  // narrower selector. For now we send to all admins as a default broadcast.
  const recipients = users.filter((u) => u.type === "admin" || (u as User & { extra_permissions?: string[] }).extra_permissions?.includes(args.permission));

  let sent = 0;
  let skipped = 0;
  for (const u of recipients) {
    const r = await notifyUser({
      userId: String(u._id),
      username: u.name,
      kind: args.kind,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    if (r.ok) sent++;
    else skipped++;
  }
  return { sent, skipped, total: recipients.length };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
