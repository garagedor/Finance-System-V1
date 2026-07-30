import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import { requirePermission } from '@/lib/rbac';
import type { AreaManager } from '@/types/areaManager';

const DB_NAME = 'ag';
const COLLECTION = 'AreaManager';

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const c = await getMongoClient();
  await c.connect();
  cachedClient = c;
  return c;
}

const normalize = (row: any): AreaManager => ({
  _id: row?._id?.toString(),
  name: row?.name || '',
  email: row?.email ?? null,
  phone: row?.phone ?? null,
  notes: row?.notes ?? null,
  locationIds: Array.isArray(row?.locationIds) ? row.locationIds.map(String) : [],
  w9StoragePath: row?.w9StoragePath ?? null,
  w9FileName: row?.w9FileName ?? null,
  w9MimeType: row?.w9MimeType ?? null,
  w9UploadedAt: row?.w9UploadedAt ?? null,
  w9UploadedBy: row?.w9UploadedBy ?? null,
  createdAt: row?.createdAt ?? null,
  updatedAt: row?.updatedAt ?? null,
});

export async function GET() {
  const session = await requirePermission('finance:area_managers:view');
  if (session instanceof NextResponse) return session;
  try {
    const client = await getClient();
    const col = client.db(DB_NAME).collection(COLLECTION);
    const rows = await col.find({}).sort({ name: 1 }).toArray();
    return NextResponse.json({ rows: rows.map(normalize) });
  } catch (err: any) {
    console.error('GET /api/area-managers error', err);
    return NextResponse.json({ error: 'Failed to load area managers', detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requirePermission('finance:area_managers:create');
  if (session instanceof NextResponse) return session;
  try {
    const body = await req.json();
    if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const doc = {
      name: body.name.trim(),
      email: typeof body.email === 'string' ? body.email.trim() || null : null,
      phone: typeof body.phone === 'string' ? body.phone.trim() || null : null,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      locationIds: Array.isArray(body.locationIds) ? body.locationIds.map(String) : [],
      w9StoragePath: null,
      w9FileName: null,
      w9MimeType: null,
      w9UploadedAt: null,
      w9UploadedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    const client = await getClient();
    const col = client.db(DB_NAME).collection(COLLECTION);
    const res = await col.insertOne(doc as any);
    return NextResponse.json({ created: normalize({ ...doc, _id: res.insertedId }) });
  } catch (err: any) {
    console.error('POST /api/area-managers error', err);
    return NextResponse.json({ error: 'Failed to create area manager', detail: err?.message }, { status: 500 });
  }
}

// Shared filter helper for routes nested under [id].
export function buildIdFilter(id: string): { _id: any } | null {
  if (!id) return null;
  if (ObjectId.isValid(id) && id.length === 24) return { _id: new ObjectId(id) };
  return { _id: id as any };
}
