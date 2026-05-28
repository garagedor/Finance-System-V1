import type { User } from '../../../types/user';
import { createCrudHandlers } from '../utils/crudHandlers';
import bcrypt from 'bcryptjs';
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
  try {
    const body = await request.clone().json();
    if (body.password) {
      body.password = await bcrypt.hash(body.password, 10);
    }
    const modifiedRequest = new NextRequest(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(body),
    });
    return handlers.POST(modifiedRequest);
  } catch {
    return handlers.POST(request);
  }
};

// Hash a new password when supplied; drop the field when blank so editing
// other fields doesn't wipe the existing hash.
export const PUT = async (request: NextRequest) => {
  const denied = await gate('system:users:edit');
  if (denied) return denied;
  try {
    const body = await request.clone().json();
    if (body.password) {
      body.password = await bcrypt.hash(body.password, 10);
    } else {
      delete body.password;
    }
    const modifiedRequest = new NextRequest(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: JSON.stringify(body),
    });
    return handlers.PUT(modifiedRequest);
  } catch {
    return handlers.PUT(request);
  }
};

export const DELETE = async (request: NextRequest) => {
  const denied = await gate('system:users:delete');
  if (denied) return denied;
  return handlers.DELETE(request);
};
