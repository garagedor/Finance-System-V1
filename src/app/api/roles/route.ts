import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { coll, FINANCE_COLLECTIONS } from '@/lib/finance-db';
import { ensureRbacReady } from '@/lib/rbac-seed';
import { ALL_PERMISSIONS, type Permission, type RoleRecord } from '@/types/rbac';

const serializeRole = (r: any) => ({
  _id: String(r._id),
  key: r.key,
  label: r.label || r.key,
  description: r.description || '',
  is_system: !!r.is_system,
  permissions: Array.isArray(r.permissions) ? r.permissions : [],
  permissionCount: Array.isArray(r.permissions) ? r.permissions.length : 0,
});

// Strip any keys not in the catalog so a stale UI submission can't write
// garbage. Dedup along the way.
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

export async function GET() {
  const session = await requirePermission('system:roles:view');
  if (session instanceof NextResponse) return session;
  try {
    await ensureRbacReady();
    const rows = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).find({}).toArray();
    return NextResponse.json({ rows: rows.map(serializeRole) });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load roles', detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requirePermission('system:roles:create');
  if (session instanceof NextResponse) return session;
  try {
    await ensureRbacReady();
    const body = await req.json();
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });

    // Derive a stable key from the label if the caller didn't supply one.
    // The key is what permission gates reference, so we want it slug-shaped.
    const rawKey = typeof body.key === 'string' && body.key.trim()
      ? body.key.trim()
      : label;
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) return NextResponse.json({ error: 'unable to derive a role key' }, { status: 400 });

    const c = coll<RoleRecord>(FINANCE_COLLECTIONS.role);
    const existing = await c.findOne({ key });
    if (existing) return NextResponse.json({ error: `Role "${key}" already exists` }, { status: 409 });

    const doc = {
      key,
      label,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      permissions: sanitizePerms(body.permissions),
      // Custom roles are never `is_system: true` — system roles are seeded
      // by ensureRbacReady on boot and shouldn't be created through the UI.
      is_system: false,
      created_at: new Date().toISOString(),
      created_by: session.name,
    };
    const insert = await c.insertOne(doc as any);
    const inserted = await c.findOne({ _id: insert.insertedId } as any);
    return NextResponse.json({ row: serializeRole(inserted) }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to create role', detail: err?.message }, { status: 500 });
  }
}
