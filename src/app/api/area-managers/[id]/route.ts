import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import { requirePermission } from '@/lib/rbac';
import { deleteW9 } from '@/lib/area-manager-storage';
import type { AreaManager } from '@/types/areaManager';

const DB_NAME = 'ag';
const COLLECTION = 'AreaManager';
const PAYMENT_COLLECTION = 'AreaManagerPayment';

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const c = await getMongoClient();
  await c.connect();
  cachedClient = c;
  return c;
}

const idFilter = (id: string) => {
  if (ObjectId.isValid(id) && id.length === 24) return { _id: new ObjectId(id) } as any;
  return { _id: id } as any;
};

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:view');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const client = await getClient();
    const col = client.db(DB_NAME).collection(COLLECTION);
    const row = await col.findOne(idFilter(id));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ areaManager: normalize(row) });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load', detail: err?.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:edit');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const body = await req.json();
    const update: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (typeof body.name === 'string') update.name = body.name.trim();
    if ('email' in body) update.email = typeof body.email === 'string' ? body.email.trim() || null : null;
    if ('phone' in body) update.phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
    if ('notes' in body) update.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    if ('locationIds' in body) update.locationIds = Array.isArray(body.locationIds) ? body.locationIds.map(String) : [];

    const client = await getClient();
    const col = client.db(DB_NAME).collection(COLLECTION);
    const result = await col.findOneAndUpdate(idFilter(id), { $set: update }, { returnDocument: 'after' as any });
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ updated: normalize(result) });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to update', detail: err?.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:delete');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const client = await getClient();
    const db = client.db(DB_NAME);
    const am = await db.collection(COLLECTION).findOne(idFilter(id));
    if (!am) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Best-effort cleanup of W9 + payments; failures are non-fatal so the
    // delete can still proceed.
    if (am.w9StoragePath) {
      try { await deleteW9(am.w9StoragePath); } catch (e) { console.warn('W9 delete failed', e); }
    }
    await db.collection(PAYMENT_COLLECTION).deleteMany({ areaManagerId: String(am._id) });
    await db.collection(COLLECTION).deleteOne(idFilter(id));
    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to delete', detail: err?.message }, { status: 500 });
  }
}
