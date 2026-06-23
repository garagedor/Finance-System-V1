import { redirect } from "next/navigation";
import { readSession, hasPermission } from "@/lib/rbac";
import { isEmailConfigured } from "@/lib/email";
import { PageHeader, CardShell } from "../../_components/page-helpers";
import AdminTabs from "../AdminTabs";
import TestEmailForm from "./TestEmailForm";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await readSession();
  if (!session) redirect("/?next=/portal/admin/notifications");
  if (!hasPermission(session, "system:integrations:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Admin" title="Notifications" />
        <div className="portal-alert portal-alert-error">No access to integrations.</div>
      </div>
    );
  }
  const configured = isEmailConfigured();

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Admin"
        title="Notifications"
        subtitle="Transactional email via Resend. The system fires emails for payouts, recurring expenses, big unmatched bank transactions, and security events."
      />
      <AdminTabs />

      <CardShell title="Resend" subtitle={configured ? "Configured" : "Not configured — set RESEND_API_KEY in .env.local"}>
        <div style={{ padding: 16 }}>
          {configured ? (
            <TestEmailForm canSend={hasPermission(session, "system:integrations:edit")} />
          ) : (
            <div className="portal-alert portal-alert-warn">
              Sign up at <a href="https://resend.com" target="_blank" rel="noreferrer" style={{ color: "#818cf8" }}>resend.com</a> (free tier: 3K emails/month), copy your API key, then add to <code>.env.local</code>:
              <pre style={{ marginTop: 10, background: "#0a0f1c", padding: 10, borderRadius: 6, fontSize: 12 }}>
{`RESEND_API_KEY=re_xxx...
RESEND_FROM="LBS Finance <noreply@yourdomain.com>"`}
              </pre>
              Restart the dev server after editing.
            </div>
          )}
        </div>
      </CardShell>

      <CardShell title="Email triggers" subtitle="What gets sent automatically">
        <table className="portal-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Recipients</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Recurring expense generated</td>
              <td>Admins + bookkeepers</td>
              <td><span className="pill pill-paid">enabled</span></td>
            </tr>
            <tr>
              <td>Large unmatched bank transaction (&gt;$1,000)</td>
              <td>Admins + bookkeepers</td>
              <td><span className="pill pill-paid">enabled</span></td>
            </tr>
            <tr>
              <td>New bank connection</td>
              <td>Admins</td>
              <td><span className="pill pill-paid">enabled</span></td>
            </tr>
            <tr>
              <td>Failed login attempts (5+ in 5min)</td>
              <td>Admins</td>
              <td><span className="pill pill-paid">enabled</span></td>
            </tr>
            <tr>
              <td>Weekly P&amp;L summary (Mondays 9am UTC)</td>
              <td>Admins + bookkeepers</td>
              <td><span className="pill pill-pending">requires Vercel cron</span></td>
            </tr>
          </tbody>
        </table>
      </CardShell>
    </div>
  );
}
