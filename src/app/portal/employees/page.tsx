import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { PayoutProfile, PositionRecord } from "@/types/finance";
import { PageHeader, StatPill, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";
import RowActions from "../_components/RowActions";

export const dynamic = "force-dynamic";

async function load() {
  await ensureFinanceIndexes();
  const [positions, profiles] = await Promise.all([
    coll<PositionRecord>(FINANCE_COLLECTIONS.position).find({}).sort({ name: 1 }).toArray(),
    coll<PayoutProfile>(FINANCE_COLLECTIONS.payoutProfile).find({ active: true }).toArray(),
  ]);
  return { positions, profiles };
}

export default async function EmployeesPage() {
  const d = await load();
  const POSITION_FIELDS: FieldDef[] = [
    { name: "name", label: "Person name", kind: "text", required: true, width: "half" },
    { name: "role", label: "Role / title", kind: "text", required: true, width: "half",
      placeholder: "e.g. Office Manager, Installer" },
    {
      name: "profile_id", label: "Default payout profile", kind: "select",
      options: d.profiles.map((p) => ({ value: p._id, label: p.name })),
      help: "Defines which payout components apply when running their payouts.",
    },
    { name: "area", label: "Area", kind: "text", width: "half" },
    { name: "email", label: "Email", kind: "text", width: "half" },
    { name: "phone", label: "Phone", kind: "text", width: "half" },
    { name: "active", label: "Active", kind: "boolean", defaultValue: true, width: "half",
      help: "Active employees appear in payout pickers." },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];

  const active = d.positions.filter((p) => p.active).length;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="People"
        title="Employees & Positions"
        subtitle="Office staff, managers, partners — define positions and link them to payout profiles."
        actions={
          <EntryFormModal
            endpoint="/api/portal/positions"
            title="Position"
            fields={POSITION_FIELDS}
            triggerLabel="+ Add position"
            primary
          />
        }
      />

      <section className="portal-grid-3">
        <StatPill label="Total employees" value={d.positions.length.toLocaleString()} />
        <StatPill label="Active" value={active.toLocaleString()} />
        <StatPill label="Payout profiles available" value={d.profiles.length.toLocaleString()} />
      </section>

      <CardShell title="Positions" subtitle={`${d.positions.length} records`}>
        {d.positions.length === 0 ? (
          <Empty
            message="No positions configured yet."
            action={
              <EntryFormModal
                endpoint="/api/portal/positions"
                title="Position"
                fields={POSITION_FIELDS}
                triggerLabel="+ Add your first employee"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Area</th>
                <th>Profile</th>
                <th>Contact</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.positions.map((p) => {
                const profile = d.profiles.find((pr) => pr._id === p.profile_id);
                return (
                  <tr key={p._id}>
                    <td><strong>{p.name}</strong></td>
                    <td className="small">{p.role}</td>
                    <td className="muted small">{p.area ?? "—"}</td>
                    <td className="muted small">{profile?.name ?? "—"}</td>
                    <td className="muted small">
                      {p.email && <div>{p.email}</div>}
                      {p.phone && <div>{p.phone}</div>}
                      {!p.email && !p.phone && "—"}
                    </td>
                    <td>
                      <StatusPill status={p.active ? "paid" : "draft"} />
                    </td>
                    <td className="right">
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                        <EntryFormModal
                          endpoint="/api/portal/positions"
                          title="Edit position"
                          fields={POSITION_FIELDS}
                          initial={p as unknown as Record<string, unknown> & { _id?: string }}
                          triggerLabel="Edit"
                        />
                        <RowActions
                          endpoint="/api/portal/positions"
                          id={p._id}
                          canToggleStatus={false}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
