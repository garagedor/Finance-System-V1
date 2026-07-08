import { redirect } from "next/navigation";
import { readSession } from "@/lib/rbac";
import { getDb } from "@/lib/finance-db";
import { userIdFilter } from "@/lib/user-id";
import type { User } from "@/types/user";
import { PageHeader, CardShell } from "../../_components/page-helpers";
import TotpEnrollment from "./TotpEnrollment";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await readSession();
  if (!session || !session.userId) redirect("/?next=/portal/me/security");

  const db = await getDb();
  const u = await db
    .collection<User>("users")
    .findOne(userIdFilter<User>(session.userId), {
      projection: { password: 0, totp_secret: 0, totp_backup_codes: 0 },
    });

  const enabled = !!u?.totp_enabled;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="My account"
        title="Security"
        subtitle="Two-factor authentication adds a code from your phone on every sign-in. Strongly recommended for accounts that can move money."
      />

      <CardShell
        title="Two-factor authentication (TOTP)"
        subtitle={enabled ? "Enabled" : "Not enabled"}
      >
        <div style={{ padding: 18 }}>
          <TotpEnrollment enabled={enabled} />
        </div>
      </CardShell>
    </div>
  );
}
