import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession, hasPermission } from "@/lib/rbac";
import { ensureRbacReady } from "@/lib/rbac-seed";
import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { RoleRecord } from "@/types/rbac";
import { PERMISSION_CATALOG } from "@/types/rbac";
import { PageHeader, CardShell, StatPill } from "../../_components/page-helpers";
import AdminTabs from "../AdminTabs";
import NewRoleButton from "./NewRoleButton";

export const dynamic = "force-dynamic";

export default async function RolesIndexPage() {
  const session = await readSession();
  if (!session) redirect("/?next=/portal/admin/roles");
  if (!hasPermission(session, "system:roles:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Admin" title="Roles & Permissions" />
        <div className="portal-alert portal-alert-error">
          You don&apos;t have permission to view roles. Required:{" "}
          <code>system:roles:view</code>
        </div>
      </div>
    );
  }
  await ensureRbacReady();
  const roles = await coll<RoleRecord>(FINANCE_COLLECTIONS.role)
    .find({})
    .sort({ is_system: -1, name: 1 })
    .toArray();

  const canCreate = hasPermission(session, "system:roles:create");

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Admin"
        title="Roles & Permissions"
        subtitle="Define what each role can see and do. System roles can be edited but not deleted."
        actions={canCreate ? <NewRoleButton roles={roles.map((r) => ({ _id: r._id, name: r.name }))} /> : undefined}
      />

      <AdminTabs />

      <section className="portal-grid-3">
        <StatPill label="Roles" value={roles.length.toLocaleString()} />
        <StatPill
          label="System roles"
          value={roles.filter((r) => r.is_system).length.toLocaleString()}
        />
        <StatPill
          label="Custom roles"
          value={roles.filter((r) => !r.is_system).length.toLocaleString()}
        />
      </section>

      <CardShell title="All roles" subtitle={`${PERMISSION_CATALOG.length} permissions available`}>
        <table className="portal-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Permissions</th>
              <th>Source</th>
              <th>Updated</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r._id}>
                <td>
                  <Link
                    href={`/portal/admin/roles/${r._id}`}
                    style={{ fontWeight: 500, color: "#cbd5e1" }}
                  >
                    {r.name}
                  </Link>
                  {r.key && <div className="muted small mono">{r.key}</div>}
                </td>
                <td className="small muted">{r.description ?? "—"}</td>
                <td className="small mono">{r.permissions.length}</td>
                <td>
                  {r.is_system ? (
                    <span className="pill pill-closed">System</span>
                  ) : (
                    <span className="pill pill-draft">Custom</span>
                  )}
                </td>
                <td className="small mono">{r.updated_at?.slice(0, 10) ?? "—"}</td>
                <td className="right">
                  <Link href={`/portal/admin/roles/${r._id}`} className="portal-btn">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardShell>
    </div>
  );
}
