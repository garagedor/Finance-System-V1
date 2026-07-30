import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import { requirePermission } from '@/lib/rbac';
import { getW9SignedUrl } from '@/lib/area-manager-storage';

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

// Redirects to a short-lived signed URL so the browser downloads directly
// from Supabase instead of streaming through our server.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:view');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const client = await getClient();
    const am = await client.db(DB_NAME).collection('AreaManager').findOne(idFilter(id));
    if (!am) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!am.w9StoragePath) return NextResponse.json({ error: 'No W9 on file' }, { status: 404 });
    const url = await getW9SignedUrl(String(am.w9StoragePath), 3600);
    return NextResponse.json({ url, fileName: am.w9FileName });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to get download URL', detail: err?.message }, { status: 500 });
  }
}
