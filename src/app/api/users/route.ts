import type { User } from '../../../types/user';
import { createCrudHandlers } from '../utils/crudHandlers';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import type { Permission } from '@/types/rbac';

/** Returns null if the session holds the given permission, else a 401/403. */
const gate = async (perm: Permission): Promise<NextResponse | null> => {
  const s = await requirePermission(perm);
  if (s instanceof NextResponse) return s;
  return null;
};

const normalizeUser = (row: any): User => {
  const fallbackType = row?.admin ? 'admin' : 'simple';
  return {
    _id: row?._id?.toString(),
    name: row?.name || '',
    password: row?.password || '',
    type: row?.type || fallbackType,
  };
};


/**
 * The legacy CRUD door is not an RBAC mutation path.
 *
 * `createCrudHandlers` applies `$set: { ...body }`, so before this allowlist
 * anything in the body reached the user document verbatim: arbitrary strings
 * in `extra_permissions`, `role_id`, `type`, `active`, `warehouse_agent`, even
 * `session_version` — which could be lowered to revive a token that should be
 * dead. None of it was validated against the permission catalog, none of it
 * bumped `session_version`, and none of it was audited.
 *
 * There is now exactly one path for that state:
 * PATCH /api/portal/admin/users, which sanitises permissions, bumps
 * session_version through INVALIDATING_FIELDS, and writes an audit record.
 *
 * This route keeps only profile fields. Anything else is refused loudly and
 * told where to go, rather than being dropped silently — a caller that thinks
 * it disabled an account needs to know it did not.
 */
export const PROFILE_FIELDS = new Set(['_id', 'id', 'name', 'email', 'notification_prefs']);

export const SECURITY_FIELDS = new Set([
  'active', 'password', 'role_id', 'type',
  'extra_permissions', 'denied_permissions', 'warehouse_agent',
  'session_version', 'session_version_reason', 'session_version_at',
  'totp_secret', 'totp_enabled', 'totp_backup_codes', 'totp_last_step',
]);

/** Null when the body is acceptable, else the response to return. */
export const refuseNonProfileFields = (body: Record<string, unknown>): NextResponse | null => {
  const offered = Object.keys(body ?? {});
  const security = offered.filter((k) => SECURITY_FIELDS.has(k));
  const unknown = offered.filter((k) => !PROFILE_FIELDS.has(k) && !SECURITY_FIELDS.has(k));
  if (security.length === 0 && unknown.length === 0) return null;
  return NextResponse.json(
    {
      error: 'unsupported_fields',
      detail:
        'This endpoint updates profile fields only. Use PATCH /api/portal/admin/users '
        + 'for roles, permissions, account status, passwords and Warehouse Agent status — '
        + 'it validates permissions and invalidates existing sessions. Refused: '
        + [...security, ...unknown].join(', '),
      security_fields: security,
      unknown_fields: unknown,
    },
    { status: 400 },
  );
};

const handlers = createCrudHandlers<User>({
  collectionName: 'users',
  sortableFields: ['name', 'type'],
  defaultSort: { field: 'name', dir: 1 },
  normalizeRow: normalizeUser,
});

export const GET = async (request: NextRequest) => {
  const denied = await gate('system:users:view');
  if (denied) return denied;
  return handlers.GET(request);
};

export const POST = async (request: NextRequest) => {
  const denied = await gate('system:users:create');
  if (denied) return denied;
  // Creating a user means choosing its type, password and permissions, which
  // is exactly the state this route no longer writes.
  return NextResponse.json(
    {
      error: 'moved',
      detail: 'Create users through POST /api/portal/admin/users, which validates '
        + 'permissions and writes an audit record.',
    },
    { status: 400 },
  );
};

// Hash a new password when supplied; drop the field when blank so editing
// other fields doesn't wipe the existing hash.
export const PUT = async (request: NextRequest) => {
  const denied = await gate('system:users:edit');
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await request.clone().json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const refusal = refuseNonProfileFields(body);
  if (refusal) return refusal;
  return handlers.PUT(request);
};

export const DELETE = async () => {
  // The canonical path refuses to delete the last active admin. This one never
  // did, which makes it the weaker of two doors to the same outcome.
  return NextResponse.json(
    {
      error: 'moved',
      detail: 'Delete users through DELETE /api/portal/admin/users?_id=…, which refuses '
        + 'to remove the last active admin.',
    },
    { status: 400 },
  );
};
