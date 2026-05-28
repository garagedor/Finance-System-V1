import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { coll, FINANCE_COLLECTIONS } from '@/lib/finance-db';
import { ensureRbacReady } from '@/lib/rbac-seed';
import type { RoleRecord } from '@/types/rbac';

export async function GET() {
  const session = await requirePermission('system:roles:view');
  if (session instanceof NextResponse) return session;
  try {
    await ensureRbacReady();
    const rows = await coll<RoleRecord>(FINANCE_COLLECTIONS.role).find({}).toArray();
    return NextResponse.json({
      rows: rows.map((r) => ({
        _id: String(r._id),
        key: r.key,
        label: (r as any).label || r.key,
        description: (r as any).description || '',
        is_system: !!(r as any).is_system,
        permissionCount: Array.isArray(r.permissions) ? r.permissions.length : 0,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load roles', detail: err?.message }, { status: 500 });
  }
}
