import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import { requirePermission } from '@/lib/rbac';
import type { AreaManagerPayment } from '@/types/areaManager';

const DB_NAME = 'ag';

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const c = await getMongoClient();
  await c.connect();
  cachedClient = c;
  return c;
}

const idFilter = (id: string): any => {
  if (ObjectId.isValid(id) && id.length === 24) return { _id: new ObjectId(id) };
  return { _id: id };
};

const normalizePayment = (row: any): AreaManagerPayment => ({
  _id: row?._id?.toString(),
  areaManagerId: String(row?.areaManagerId || ''),
  date: row?.date || '',
  amount: Number(row?.amount || 0),
  direction: row?.direction === 'am_to_company' ? 'am_to_company' : 'company_to_am',
  method: row?.method || 'other',
  note: row?.note ?? null,
  recordedBy: row?.recordedBy ?? null,
  createdAt: row?.createdAt ?? null,
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:view');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const client = await getClient();
    const col = client.db(DB_NAME).collection('AreaManagerPayment');
    const rows = await col.find({ areaManagerId: String(id) })
      .sort({ date: -1, createdAt: -1 })
      .toArray();
    return NextResponse.json({ rows: rows.map(normalizePayment) });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load payments', detail: err?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:edit');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const body = await req.json();
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }
    if (body?.direction !== 'company_to_am' && body?.direction !== 'am_to_company') {
      return NextResponse.json({ error: 'direction must be company_to_am or am_to_company' }, { status: 400 });
    }
    if (!body?.date || typeof body.date !== 'string') {
      return NextResponse.json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 });
    }

    // Sanity: AM must exist
    const client = await getClient();
    const db = client.db(DB_NAME);
    const am = await db.collection('AreaManager').findOne(idFilter(id));
    if (!am) return NextResponse.json({ error: 'Area manager not found' }, { status: 404 });

    const doc = {
      areaManagerId: String(am._id),
      date: String(body.date),
      amount,
      direction: body.direction,
      method: typeof body.method === 'string' && body.method.trim() ? body.method.trim() : 'other',
      note: typeof body.note === 'string' ? body.note.trim() || null : null,
      recordedBy: (session as any)?.user_id || null,
      createdAt: new Date().toISOString(),
    };
    const res = await db.collection('AreaManagerPayment').insertOne(doc as any);
    return NextResponse.json({ created: normalizePayment({ ...doc, _id: res.insertedId }) });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to record payment', detail: err?.message }, { status: 500 });
  }
}
