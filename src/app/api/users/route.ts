import type { User } from '../../../types/user';
import { createCrudHandlers } from '../utils/crudHandlers';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode('super-secret-key-for-development');

const requireAdmin = async (request: NextRequest): Promise<NextResponse | null> => {
  const session = request.cookies.get('session')?.value;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { payload } = await jwtVerify(session, JWT_SECRET);
    if ((payload as { type?: string }).type !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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
  const denied = await requireAdmin(request);
  if (denied) return denied;
  return handlers.GET(request);
};

export const POST = async (request: NextRequest) => {
  const denied = await requireAdmin(request);
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
  } catch (e) {
    return handlers.POST(request);
  }
};

// Hash a new password when supplied; drop the field when blank so editing
// other fields doesn't wipe the existing hash.
export const PUT = async (request: NextRequest) => {
  const denied = await requireAdmin(request);
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
  } catch (e) {
    return handlers.PUT(request);
  }
};

export const DELETE = async (request: NextRequest) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  return handlers.DELETE(request);
};
