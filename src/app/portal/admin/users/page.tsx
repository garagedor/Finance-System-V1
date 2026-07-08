import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession, hasPermission } from "@/lib/rbac";
import { ensureRbacReady } from "@/lib/rbac-seed";
import { coll, FINANCE_COLLECTIONS, getDb } from "@/lib/finance-db";
import type { User } from "@/types/user";
import type { RoleRecord } from "@/types/rbac";
import { PageHeader, CardShell, StatPill, FilterBar, FilterField } from "../../_components/page-helpers";
import AdminTabs from "../AdminTabs";
import NewUserButton from "./NewUserButton";

export const dynamic = "force-dynamic";

interface SP {
  q?: string;
  role?: string;
  status?: "active" | "inactive" | "";
}

export default async function UsersIndexPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await readSession();
  if (!session) redirect("/?next=/portal/admin/users");
  if (!hasPermission(session, "system:users:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Admin" title="Users" />
        <div className="portal-alert portal-alert-error">
          You don&apos;t have permission to view users.
        </div>
      </div>
    );
  }
  await ensureRbacReady();
  const sp = await searchParams;
  const db = await getDb();

  const filter: Record<string, unknown> = {};
  if (sp.q) filter.name = { $regex: sp.q, $options: "i" };
  if (sp.role) filter.role_id = sp.role;
  if (sp.status === "active") filter.$or = [{ active: { $exists: false } }, { active: true }];
  if (sp.status === "inactive") filter.active = false;

  const [users, roles] = await Promise.all([
    db
      .collection<User>("users")
      .find(filter, { projection: { password: 0 } })
      .sort({ name: 1 })
      .toArray(),
    coll<RoleRecord>(FINANCE_COLLECTIONS.role).find({}).sort({ name: 1 }).toArray(),
  ]);

  const roleNameById = new Map(roles.map((r) => [r._id, r.name]));
  const activeCount = users.filter((u) => u.active !== false).length;
  const canCreate = hasPermission(session, "system:users:create");

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Admin"
        title="Users"
        subtitle="Manage accounts, role assignments, and custom per-user permissions."
        actions={canCreate ? <NewUserButton roles={roles.map((r) => ({ _id: r._id, name: r.name }))} /> : undefined}
      />

      <AdminTabs />

      <section className="portal-grid-3">
        <StatPill label="Total users" value={users.length.toLocaleString()} />
        <StatPill label="Active" value={activeCount.toLocaleString()} />
        <StatPill
          label="Inactive"
          value={(users.length - activeCount).toLocaleString()}
        />
      </section>

      <FilterBar>
        <FilterField label="Name contains">
          <input type="text" name="q" defaultValue={sp.q ?? ""} className="portal-input" />
        </FilterField>
        <FilterField label="Role">
          <select name="role" defaultValue={sp.role ?? ""} className="portal-select">
            <option value="">Any</option>
            {roles.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select name="status" defaultValue={sp.status ?? ""} className="portal-select">
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/admin/users" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="All users" subtitle={`${users.length} matching`}>
        <table className="portal-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Type</th>
              <th>Status</th>
              <th>Custom perms</th>
              <th>Last login</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const id = String(u._id);
              const extra = u.extra_permissions?.length ?? 0;
              const denied = u.denied_permissions?.length ?? 0;
              const customStr = extra || denied ? `+${extra} / −${denied}` : "—";
              return (
                <tr key={id}>
                  <td>
                    <Link href={`/portal/admin/users/${encodeURIComponent(id)}`} style={{ color: "#cbd5e1", fontWeight: 500 }}>
                      {u.name}
                    </Link>
                  </td>
                  <td className="small">{u.role_id ? roleNameById.get(u.role_id) ?? "—" : <span className="muted">No role</span>}</td>
                  <td className="small mono">{u.type}</td>
                  <td>
                    <span className={`pill ${u.active === false ? "pill-unpaid" : "pill-paid"}`}>
                      {u.active === false ? "inactive" : "active"}
                    </span>
                  </td>
                  <td className="small mono">{customStr}</td>
                  <td className="small mono">{u.last_login_at?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className="right">
                    <Link href={`/portal/admin/users/${encodeURIComponent(id)}`} className="portal-btn">
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardShell>
    </div>
  );
}
