import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, tryDb, getDbConnectError } from "@/lib/finance-db";
import type { PayoutProfile } from "@/types/finance";
import { PageHeader, StatPill, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import { DbDownBanner } from "../_components/DbDownBanner";
import RowActions from "../_components/RowActions";
import PayoutProfileForm from "./PayoutProfileForm";

export const dynamic = "force-dynamic";

async function load() {
  return tryDb(async () => {
    await ensureFinanceIndexes();
    const profiles = await coll<PayoutProfile>(FINANCE_COLLECTIONS.payoutProfile)
      .find({})
      .sort({ name: 1 })
      .toArray();
    return { profiles };
  });
}

export default async function SettingsPage() {
  const d = await load();

  if (!d) {
    const err = getDbConnectError();
    return (
      <div className="portal-page">
        <PageHeader
          kicker="System"
          title="Finance Settings"
          subtitle="Payout profiles, default fees, expense categories, role access."
        />
        <DbDownBanner error={err?.message ?? null} />
      </div>
    );
  }

  const activeCount = d.profiles.filter((p) => p.active).length;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="System"
        title="Finance Settings"
        subtitle="Payout profiles, default fees, expense categories, role access."
        actions={<PayoutProfileForm />}
      />

      <section className="portal-grid-3">
        <StatPill label="Payout profiles" value={d.profiles.length.toLocaleString()} />
        <StatPill label="Active profiles" value={activeCount.toLocaleString()} />
        <StatPill label="Inactive" value={(d.profiles.length - activeCount).toLocaleString()} />
      </section>

      <CardShell
        title="Payout profiles"
        subtitle="Define which components apply to each role / payout plan"
      >
        {d.profiles.length === 0 ? (
          <Empty
            message="No payout profiles yet. Define one for each role you pay (e.g. Area Manager 40%, Office Manager, Installer Plan A)."
            action={<PayoutProfileForm />}
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Applies to</th>
                <th>Description</th>
                <th className="right">Components</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.profiles.map((p) => (
                <tr key={p._id}>
                  <td><strong>{p.name}</strong></td>
                  <td className="muted small">{p.applies_to_role ?? "—"}</td>
                  <td className="small">{p.description ?? "—"}</td>
                  <td className="right small">{p.components.length}</td>
                  <td><StatusPill status={p.active ? "paid" : "draft"} /></td>
                  <td className="right" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <PayoutProfileForm initial={p} />
                    <RowActions
                      endpoint="/api/portal/payout-profiles"
                      id={p._id}
                      canToggleStatus={false}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      <CardShell title="Role access">
        <div style={{ padding: 16, fontSize: 13, color: "#94a3b8" }}>
          <p style={{ margin: "0 0 10px" }}>
            The Finance Portal is restricted to these roles:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            <li><strong style={{ color: "#cbd5e1" }}>admin</strong> — full access</li>
            <li><strong style={{ color: "#cbd5e1" }}>office</strong> — full access (office manager / staff)</li>
            <li><strong style={{ color: "#cbd5e1" }}>bookkeeper</strong> — full access (new role)</li>
          </ul>
          <p style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
            Technicians, location-managers, and simple users do NOT have portal access. To grant
            bookkeeper access, set <code style={{ color: "#cbd5e1", background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: 4 }}>user.type = &quot;bookkeeper&quot;</code>{" "}
            in the Users table.
          </p>
        </div>
      </CardShell>
    </div>
  );
}
