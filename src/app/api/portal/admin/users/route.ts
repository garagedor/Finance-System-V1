// Users CRUD for the admin panel. Gated by `system:users:*` permissions.
// Returns user rows WITHOUT password hashes. Mutations write to the audit log.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { ensureFinanceIndexes, getDb, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { coll } from "@/lib/finance-db";
import { requirePermission } from "@/lib/rbac";
import { userIdFilter } from "@/lib/user-id";
import { PERMISSION_BY_KEY, type Permission, type RoleAuditRecord, type RoleRecord } from "@/types/rbac";
import type { User, UserType } from "@/types/user";

export const dynamic = "force-dynamic";

interface PublicUser {
  _id: string;
  name: string;
  type: UserType;
  role_id?: string;
  role_name?: string;
  active: boolean;
  extra_permissions: Permission[];
  denied_permissions: Permission[];
  created_at?: string;
  updated_at?: string;
  last_login_at?: string;
}

function sanitisePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Permission[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    if (!PERMISSION_BY_KEY[raw]) continue;
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
  await coll<RoleAuditRecord>(FINANCE_COLLECTIONS.roleAudit).insertOne({
    _id: newId("rba"),
    target_kind: "user",
    target_id: args.target_id,
    before: args.before,
    after: args.after,
    summary: args.summary,
    changed_by: args.changed_by,
    changed_at: new Date().toISOString(),
  });
}

function toPublic(u: User, roleName?: string): PublicUser {
  return {
    _id: String(u._id),
    name: u.name,
    type: u.type,
    role_id: u.role_id,
    role_name: roleName,
    active: u.active ?? true,
    extra_permissions: u.extra_permissions ?? [],
    denied_permissions: u.denied_permissions ?? [],
    created_at: u.created_at,
    updated_at: u.updated_at,
    last_login_at: u.last_login_at,
  };
}

const VALID_TYPES: UserType[] = ["admin", "office", "location-manager", "simple", "bookkeeper"];

export async function GET() {
  const session = await requirePermission("system:users:view");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const db = await getDb();
  const users = await db
    .collection<User>("users")
    .find({}, { projection: { password: 0 } })
    .sort({ name: 1 })
    .toArray();
  const roles = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).find({}).toArray();
  const roleNameById = new Map(roles.map((r) => [r._id, r.name]));
  return NextResponse.json({
    rows: users.map((u) => toPublic(u, u.role_id ? roleNameById.get(u.role_id) : undefined)),
  });
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("system:users:create");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  try {
    const body = (await req.json()) as {
      name?: string;
      password?: string;
      type?: UserType;
      role_id?: string;
      active?: boolean;
      extra_permissions?: unknown;
      denied_permissions?: unknown;
    };
    const name = String(body.name ?? "").trim();
    const password = String(body.password ?? "");
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    const type = (body.type ?? "simple") as UserType;
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
    }

    const db = await getDb();
    const usersColl = db.collection<User>("users");
    const dup = await usersColl.findOne({ name });
    if (dup) return NextResponse.json({ error: "Username already taken" }, { status: 409 });

    // If role_id given, verify it exists.
    let roleId = body.role_id;
    if (roleId) {
      const exists = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).findOne({ _id: roleId });
      if (!exists) return NextResponse.json({ error: "role_id not found" }, { status: 400 });
    } else {
      // Default: match the `type` to its system role.
      const sys = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).findOne({ key: type });
      roleId = sys?._id;
    }

    const hashed = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const id = newId("usr");
    const doc: User = {
      _id: id,
      name,
      password: hashed,
      type,
      role_id: roleId,
      active: body.active ?? true,
      extra_permissions: sanitisePermissions(body.extra_permissions),
      denied_permissions: sanitisePermissions(body.denied_permissions),
      created_at: now,
      updated_at: now,
    };
    await usersColl.insertOne(doc as never);
    await writeAudit({
      target_id: id,
      before: null,
      after: { ...doc, password: "[redacted]" },
      summary: `Created user "${name}" (${type})`,
      changed_by: session.name,
    });
    return NextResponse.json({ row: toPublic(doc) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Create failed" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requirePermission("system:users:edit");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  try {
    const body = (await req.json()) as {
      _id?: string;
      name?: string;
      type?: UserType;
      role_id?: string | null;
      active?: boolean;
      extra_permissions?: unknown;
      denied_permissions?: unknown;
      new_password?: string;
    };
    if (!body._id) return NextResponse.json({ error: "_id required" }, { status: 400 });

    const db = await getDb();
    const usersColl = db.collection<User>("users");
    const existing = await usersColl.findOne(userIdFilter<User>(body._id));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existingId = existing._id as unknown as string;

    const set: Partial<User> = { updated_at: new Date().toISOString() };
    const summaryParts: string[] = [];

    if (typeof body.name === "string") {
      const newName = body.name.trim();
      if (!newName) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      if (newName !== existing.name) {
        const dup = await usersColl.findOne({ name: newName, _id: { $ne: existingId } } as never);
        if (dup) return NextResponse.json({ error: "Username already taken" }, { status: 409 });
        set.name = newName;
        summaryParts.push(`renamed → ${newName}`);
      }
    }
    if (typeof body.type === "string") {
      if (!VALID_TYPES.includes(body.type)) {
        return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
      }
      if (body.type !== existing.type) {
        set.type = body.type;
        summaryParts.push(`type: ${existing.type} → ${body.type}`);
      }
    }
    if (body.role_id !== undefined) {
      if (body.role_id === null) {
        set.role_id = undefined;
        summaryParts.push("cleared role");
      } else {
        const exists = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).findOne({ _id: body.role_id });
        if (!exists) return NextResponse.json({ error: "role_id not found" }, { status: 400 });
        if (body.role_id !== existing.role_id) {
          set.role_id = body.role_id;
          summaryParts.push(`role → ${exists.name}`);
        }
      }
    }
    if (typeof body.active === "boolean" && body.active !== (existing.active ?? true)) {
      set.active = body.active;
      summaryParts.push(body.active ? "activated" : "deactivated");
    }
    if (body.extra_permissions !== undefined) {
      set.extra_permissions = sanitisePermissions(body.extra_permissions);
      summaryParts.push(`extras: ${set.extra_permissions.length}`);
    }
    if (body.denied_permissions !== undefined) {
      set.denied_permissions = sanitisePermissions(body.denied_permissions);
      summaryParts.push(`denials: ${set.denied_permissions.length}`);
    }

    let passwordChanged = false;
    if (typeof body.new_password === "string" && body.new_password.length > 0) {
      // Treat password reset as a separate permission gate.
      const guard = await requirePermission("system:users:reset_password");
      if (guard instanceof NextResponse) return guard;
      if (body.new_password.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
      }
      set.password = await bcrypt.hash(body.new_password, 10);
      passwordChanged = true;
      summaryParts.push("password reset");
    }

    await usersColl.updateOne(userIdFilter<User>(body._id), { $set: set });
    const after = await usersColl.findOne(userIdFilter<User>(body._id));
    await writeAudit({
      target_id: body._id,
      before: { ...existing, password: "[redacted]" },
      after: after ? { ...after, password: passwordChanged ? "[reset]" : "[unchanged]" } : null,
      summary: `Updated user "${existing.name}": ${summaryParts.join("; ") || "no-op"}`,
      changed_by: session.name,
    });

    return NextResponse.json({ row: after ? toPublic(after) : null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requirePermission("system:users:delete");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("_id");
  if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });

  const db = await getDb();
  const usersColl = db.collection<User>("users");
  const existing = await usersColl.findOne(userIdFilter<User>(id));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Safety: refuse to delete the last active admin so nobody locks themselves out.
  if (existing.type === "admin") {
    const activeAdminCount = await usersColl.countDocuments({
      type: "admin",
      $or: [{ active: { $exists: false } }, { active: true }],
    });
    if (activeAdminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last active admin. Promote another user first." },
        { status: 400 }
      );
    }
  }
  if (String(existing._id) === session.userId) {
    return NextResponse.json({ error: "Cannot delete your own account." }, { status: 400 });
  }

  await usersColl.deleteOne(userIdFilter<User>(id));
  await writeAudit({
    target_id: id,
    before: { ...existing, password: "[redacted]" },
    after: null,
    summary: `Deleted user "${existing.name}"`,
    changed_by: session.name,
  });
  return NextResponse.json({ ok: true });
}
