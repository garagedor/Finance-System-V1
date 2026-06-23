import { notFound, redirect } from "next/navigation";
import { readSession, hasPermission } from "@/lib/rbac";
import { ensureRbacReady } from "@/lib/rbac-seed";
import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { PERMISSION_CATALOG, MODULE_LABEL, type RoleRecord } from "@/types/rbac";
import { PageHeader, CardShell, BackLink } from "../../../_components/page-helpers";
import RoleEditor from "./RoleEditor";

export const dynamic = "force-dynamic";

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await readSession();
  if (!session) redirect("/?next=/portal/admin/roles");
  if (!hasPermission(session, "system:roles:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Admin" title="Role" />
        <div className="portal-alert portal-alert-error">
          You don&apos;t have permission to view roles.
        </div>
      </div>
    );
  }
  await ensureRbacReady();
  const { id } = await params;
  const role = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).findOne({ _id: id });
  if (!role) notFound();

  const canEdit = hasPermission(session, "system:roles:edit");
  const canDelete =
    hasPermission(session, "system:roles:delete") && !role.is_system;

  // Group permissions by module → section for the matrix.
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

  return (
    <div className="portal-page">
      <BackLink href="/portal/admin/roles" label="All roles" />
      <PageHeader
        kicker={`Role · ${role.is_system ? "System" : "Custom"}`}
        title={role.name}
        subtitle={
          role.description ? (
            <>{role.description}</>
          ) : (
            <span className="muted">No description</span>
          )
        }
      />

      <CardShell
        title="Permissions"
        subtitle={`${role.permissions.length} of ${PERMISSION_CATALOG.length} granted`}
      >
        <RoleEditor
          role={role}
          grouped={groupedArr}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </CardShell>
    </div>
  );
}
