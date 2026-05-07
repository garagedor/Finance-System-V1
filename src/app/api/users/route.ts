import type { User } from '../../../types/user';
import { createCrudHandlers } from '../utils/crudHandlers';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

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

const { GET, PUT, DELETE } = handlers;

// Custom POST handler to hash the password before saving
export const POST = async (request: NextRequest) => {
  try {
    const body = await request.clone().json();

    // Hash password if provided
    if (body.password) {
      body.password = await bcrypt.hash(body.password, 10);
    }

    // Re-create the request object with the modified body
    const modifiedRequest = new NextRequest(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(body),
    });

    // Pass to the generic handler
    return handlers.POST(modifiedRequest);
  } catch (e) {
    // Fallback to generic handler if parsing fails
    return handlers.POST(request);
  }
};

export { GET, PUT, DELETE };
