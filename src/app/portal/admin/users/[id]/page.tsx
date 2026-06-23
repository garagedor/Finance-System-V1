import { notFound, redirect } from "next/navigation";
import { readSession, hasPermission, computeEffectivePermissions } from "@/lib/rbac";
import { ensureRbacReady } from "@/lib/rbac-seed";
import { coll, FINANCE_COLLECTIONS, getDb } from "@/lib/finance-db";
import { userIdFilter } from "@/lib/user-id";
import type { User } from "@/types/user";
import type { RoleRecord } from "@/types/rbac";
import { PERMISSION_CATALOG, MODULE_LABEL } from "@/types/rbac";
import { PageHeader, CardShell, BackLink, StatPill } from "../../../_components/page-helpers";
import UserEditor from "./UserEditor";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await readSession();
  if (!session) redirect("/?next=/portal/admin/users");
  if (!hasPermission(session, "system:users:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Admin" title="User" />
        <div className="portal-alert portal-alert-error">
          You don&apos;t have permission to view users.
        </div>
      </div>
    );
  }
  await ensureRbacReady();
  const { id } = await params;
  const db = await getDb();
  const user = await db.collection<User>("users").findOne(userIdFilter<User>(id), { projection: { password: 0 } });
  if (!user) notFound();

  const [roles, effective] = await Promise.all([
    coll<RoleRecord>(FINANCE_COLLECTIONS.role).find({}).sort({ name: 1 }).toArray(),
    computeEffectivePermissions({ type: user.type, role_id: user.role_id, _id: String(user._id) }),
  ]);

  const role = user.role_id ? roles.find((r) => r._id === user.role_id) : undefined;
  const rolePerms = new Set(role?.permissions ?? []);

  // Group permissions for the matrix
  const grouped = new Map<string, Map<string, typeof PERMISSION_CATALOG[number][]>>();
  for (const def of PERMISSION_CATALOG) {
    if (!grouped.has(def.module)) grouped.set(def.module, new Map());
    const sectionMap = grouped.get(def.module)!;
    if (!sectionMap.has(def.section)) sectionMap.set(def.section, []);
    sectionMap.get(def.section)!.push(def);
  }
  const groupedArr = [...grouped.entries()].map(([module, sectionMap]) => ({
    module,
    moduleLabel: MODULE_LABEL[module as keyof typeof MODULE_LABEL],
    sections: [...sectionMap.entries()].map(([section, perms]) => ({ section, perms })),
  }));

  const canEdit = hasPermission(session, "system:users:edit");
  const canDelete = hasPermission(session, "system:users:delete") && session.userId !== user._id;
  const canResetPassword = hasPermission(session, "system:users:reset_password");

  return (
    <div className="portal-page">
      <BackLink href="/portal/admin/users" label="All users" />
      <PageHeader
        kicker="User"
        title={user.name}
        subtitle={
          <>
            Type: <code className="mono">{user.type}</code> · Role:{" "}
            {role ? role.name : <span className="muted">none</span>} · Status:{" "}
            <span className={`pill ${user.active === false ? "pill-unpaid" : "pill-paid"}`}>
              {user.active === false ? "inactive" : "active"}
            </span>
          </>
        }
      />

      <section className="portal-grid-3">
        <StatPill label="Effective permissions" value={effective.length.toLocaleString()} />
        <StatPill label="From role" value={rolePerms.size.toLocaleString()} />
        <StatPill
          label="Custom overrides"
          value={`+${user.extra_permissions?.length ?? 0} / −${user.denied_permissions?.length ?? 0}`}
        />
      </section>

      <CardShell title="Account" subtitle="Role assignment and status">
        <UserEditor
          user={{
            _id: String(user._id),
            name: user.name,
            type: user.type,
            role_id: user.role_id,
            active: user.active ?? true,
            extra_permissions: user.extra_permissions ?? [],
            denied_permissions: user.denied_permissions ?? [],
          }}
          roles={roles.map((r) => ({ _id: r._id, name: r.name }))}
          rolePerms={[...rolePerms]}
          grouped={groupedArr}
          canEdit={canEdit}
          canDelete={canDelete}
          canResetPassword={canResetPassword}
          isSelf={session.userId === user._id}
        />
      </CardShell>
    </div>
  );
}
