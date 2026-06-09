import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requirePermission } from '@/lib/rbac';
import { coll, FINANCE_COLLECTIONS, getDb } from '@/lib/finance-db';
import { ensureRbacReady } from '@/lib/rbac-seed';
import { ALL_PERMISSIONS, type Permission, type RoleRecord } from '@/types/rbac';

// Per-role CRUD endpoint. List + create live one level up at /api/roles.
// All actions gated by `system:roles:*` permissions.

const idFilter = (id: string): any => {
    if (ObjectId.isValid(id) && id.length === 24) return { _id: new ObjectId(id) };
    return { _id: id };
};

// Sanity-check the permissions array — silently drop unknown keys instead
// of throwing, so a UI submitting a slightly-stale catalog still saves.
const sanitizePerms = (input: unknown): Permission[] => {
    if (!Array.isArray(input)) return [];
    const known = new Set<Permission>(ALL_PERMISSIONS);
    const seen = new Set<Permission>();
    for (const raw of input) {
        const key = String(raw);
        if (known.has(key) && !seen.has(key)) seen.add(key);
    }
    return Array.from(seen);
};

const serializeRole = (r: any) => ({
    _id: String(r._id),
    key: r.key,
    label: r.label || r.key,
    description: r.description || '',
    is_system: !!r.is_system,
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
    permissionCount: Array.isArray(r.permissions) ? r.permissions.length : 0,
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await requirePermission('system:roles:view');
    if (session instanceof NextResponse) return session;
    try {
        const { id } = await params;
        await ensureRbacReady();
        const r = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).findOne(idFilter(id));
        if (!r) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
        return NextResponse.json({ row: serializeRole(r) });
    } catch (err: any) {
        return NextResponse.json({ error: 'Failed to load role', detail: err?.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await requirePermission('system:roles:edit');
    if (session instanceof NextResponse) return session;
    try {
        const { id } = await params;
        await ensureRbacReady();
        const c = coll<RoleRecord>(FINANCE_COLLECTIONS.role);
        const existing = await c.findOne(idFilter(id));
        if (!existing) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

        const body = await req.json();
        const update: Record<string, unknown> = {};

        // System roles can have their description / permissions edited but
        // their `key` is the immutable handle used by ensureRbacReady on
        // boot — never let the API mutate it.
        if (typeof body.label === 'string')        update.label = body.label.trim() || existing.key;
        if (typeof body.description === 'string')  update.description = body.description.trim();
        if (Array.isArray(body.permissions))       update.permissions = sanitizePerms(body.permissions);
        // Non-system custom roles can additionally rename their key.
        if (!existing.is_system && typeof body.key === 'string' && body.key.trim()) {
            update.key = body.key.trim().toLowerCase().replace(/\s+/g, '_');
        }

        if (Object.keys(update).length === 0) {
            return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
        }

        const result = await c.findOneAndUpdate(
            idFilter(id),
            { $set: { ...update, updated_at: new Date().toISOString(), updated_by: session.name } } as any,
            { returnDocument: 'after' as any }
        );
        if (!result) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
        return NextResponse.json({ row: serializeRole(result) });
    } catch (err: any) {
        return NextResponse.json({ error: 'Failed to update role', detail: err?.message }, { status: 500 });
    }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await requirePermission('system:roles:delete');
    if (session instanceof NextResponse) return session;
    try {
        const { id } = await params;
        await ensureRbacReady();
        const c = coll<RoleRecord>(FINANCE_COLLECTIONS.role);
        const existing = await c.findOne(idFilter(id));
        if (!existing) return NextResponse.json({ error: 'Role not found' }, { status: 404 });
        if (existing.is_system) {
            return NextResponse.json(
                { error: 'System roles cannot be deleted — edit permissions or create a new custom role instead.' },
                { status: 400 }
            );
        }
        // Refuse to delete a role that's still assigned — would silently
        // demote users to the default `type` fallback. Force the admin to
        // reassign first so role changes stay intentional.
        const db = await getDb();
        const usersInRole = await db.collection('users').countDocuments({ role_id: String((existing as any)._id) });
        if (usersInRole > 0) {
            return NextResponse.json(
                { error: `Cannot delete: ${usersInRole} user(s) are still assigned this role. Reassign them first.` },
                { status: 400 }
            );
        }
        await c.deleteOne(idFilter(id));
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ error: 'Failed to delete role', detail: err?.message }, { status: 500 });
    }
}
