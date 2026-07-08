// Roles CRUD. Gated by `system:roles:edit`. Writes an audit row on every
// mutation. System roles can be edited freely but never deleted, and their
// stable `key` field cannot change.

import { NextRequest, NextResponse } from "next/server";
import { coll, FINANCE_COLLECTIONS, newId, ensureFinanceIndexes } from "@/lib/finance-db";
import { requirePermission } from "@/lib/rbac";
import {
  ALL_PERMISSIONS,
  PERMISSION_BY_KEY,
  type Permission,
  type RoleAuditRecord,
  type RoleRecord,
} from "@/types/rbac";

export const dynamic = "force-dynamic";

function sanitisePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  const out: Permission[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    if (!PERMISSION_BY_KEY[raw]) continue; // drop unknown perms
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

async function writeAudit(args: {
  target_id: string;
  before: unknown;
  after: unknown;
  summary: string;
  changed_by: string;
}): Promise<void> {
  const auditRow: RoleAuditRecord = {
    _id: newId("rba"),
    target_kind: "role",
    target_id: args.target_id,
    before: args.before,
    after: args.after,
    summary: args.summary,
    changed_by: args.changed_by,
    changed_at: new Date().toISOString(),
  };
  await coll<RoleAuditRecord>(FINANCE_COLLECTIONS.roleAudit).insertOne(auditRow);
}

export async function GET() {
  const session = await requirePermission("system:roles:view");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const rows = await coll<RoleRecord>(FINANCE_COLLECTIONS.role)
    .find({})
    .sort({ is_system: -1, name: 1 })
    .toArray();
  return NextResponse.json({ rows, catalog_size: ALL_PERMISSIONS.length });
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("system:roles:create");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      permissions?: unknown;
      clone_from_id?: string;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const rolesColl = coll<RoleRecord>(FINANCE_COLLECTIONS.role);
    const dup = await rolesColl.findOne({ name });
    if (dup) return NextResponse.json({ error: "Role name already exists" }, { status: 409 });

    let permissions: Permission[] = sanitisePermissions(body.permissions);
    if (body.clone_from_id) {
      const src = await rolesColl.findOne({ _id: body.clone_from_id });
      if (!src) return NextResponse.json({ error: "Source role not found" }, { status: 404 });
      permissions = sanitisePermissions([...src.permissions, ...permissions]);
    }

    const now = new Date().toISOString();
    const doc: RoleRecord = {
      _id: newId("role"),
      name,
      description: body.description?.trim() || undefined,
      permissions,
      is_system: false,
      created_at: now,
      created_by: session.name,
      updated_at: now,
      updated_by: session.name,
    };
    await rolesColl.insertOne(doc);
    await writeAudit({
      target_id: doc._id,
      before: null,
      after: doc,
      summary: `Created role "${name}" with ${permissions.length} permission(s)`,
      changed_by: session.name,
    });
    return NextResponse.json({ row: doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Create failed" },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requirePermission("system:roles:edit");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  try {
    const body = (await req.json()) as {
      _id?: string;
      name?: string;
      description?: string;
      permissions?: unknown;
    };
    if (!body._id) return NextResponse.json({ error: "_id required" }, { status: 400 });

    const rolesColl = coll<RoleRecord>(FINANCE_COLLECTIONS.role);
    const existing = await rolesColl.findOne({ _id: body._id });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const set: Partial<RoleRecord> = {};
    if (typeof body.name === "string") {
      const newName = body.name.trim();
      if (!newName) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      if (newName !== existing.name) {
        const dup = await rolesColl.findOne({ name: newName, _id: { $ne: body._id } });
        if (dup) return NextResponse.json({ error: "Role name already exists" }, { status: 409 });
        set.name = newName;
      }
    }
    if (typeof body.description === "string") {
      set.description = body.description.trim() || undefined;
    }
    if (body.permissions !== undefined) {
      set.permissions = sanitisePermissions(body.permissions);
    }
    set.updated_at = new Date().toISOString();
    set.updated_by = session.name;

    await rolesColl.updateOne({ _id: body._id }, { $set: set });
    const after = await rolesColl.findOne({ _id: body._id });

    // Summarise change
    const added = (set.permissions ?? existing.permissions).filter((p) => !existing.permissions.includes(p));
    const removed = existing.permissions.filter((p) => !(set.permissions ?? existing.permissions).includes(p));
    const summary = [
      set.name && `renamed → ${set.name}`,
      added.length && `+${added.length} perm`,
      removed.length && `−${removed.length} perm`,
    ].filter(Boolean).join("; ") || "no-op";

    await writeAudit({
      target_id: body._id,
      before: existing,
      after,
      summary: `Updated role "${existing.name}": ${summary}`,
      changed_by: session.name,
    });

    return NextResponse.json({ row: after });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requirePermission("system:roles:delete");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("_id");
  if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });

  const rolesColl = coll<RoleRecord>(FINANCE_COLLECTIONS.role);
  const existing = await rolesColl.findOne({ _id: id });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.is_system) {
    return NextResponse.json(
      { error: "System roles cannot be deleted. Edit their permissions instead." },
      { status: 400 }
    );
  }

  // Block delete if any user is assigned this role.
  const db = (await import("@/lib/finance-db")).getDb;
  const dbHandle = await db();
  const inUseCount = await dbHandle
    .collection("users")
    .countDocuments({ role_id: id });
  if (inUseCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${inUseCount} user(s) still assigned this role. Reassign them first.` },
      { status: 409 }
    );
  }

  await rolesColl.deleteOne({ _id: id });
  await writeAudit({
    target_id: id,
    before: existing,
    after: null,
    summary: `Deleted role "${existing.name}"`,
    changed_by: session.name,
  });
  return NextResponse.json({ ok: true });
}
