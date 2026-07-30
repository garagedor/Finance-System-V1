import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import { requirePermission } from '@/lib/rbac';
import { uploadW9, deleteW9 } from '@/lib/area-manager-storage';

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

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:edit');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded under "file" field' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit` }, { status: 413 });
    }

    const client = await getClient();
    const db = client.db(DB_NAME);
    const am = await db.collection('AreaManager').findOne(idFilter(id));
    if (!am) return NextResponse.json({ error: 'Area manager not found' }, { status: 404 });

    // If replacing, drop the old object first so we don't leave orphans (the
    // upload helper uses upsert, but a different file extension would create
    // a second object). Failures are non-fatal — upload still proceeds.
    if (am.w9StoragePath) {
      try { await deleteW9(am.w9StoragePath); } catch (e) { console.warn('old W9 delete failed', e); }
    }

    const bytes = await file.arrayBuffer();
    const uploaded = await uploadW9(String(am._id), {
      name: file.name,
      type: file.type,
      bytes,
    });

    const update = {
      w9StoragePath: uploaded.storagePath,
      w9FileName: uploaded.fileName,
      w9MimeType: uploaded.mimeType,
      w9UploadedAt: new Date().toISOString(),
      w9UploadedBy: (session as any)?.user_id || null,
      updatedAt: new Date().toISOString(),
    };
    await db.collection('AreaManager').updateOne(idFilter(id), { $set: update });
    return NextResponse.json({ uploaded: update });
  } catch (err: any) {
    console.error('POST /api/area-managers/[id]/w9 error', err);
    return NextResponse.json({ error: 'W9 upload failed', detail: err?.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:edit');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const client = await getClient();
    const db = client.db(DB_NAME);
    const am = await db.collection('AreaManager').findOne(idFilter(id));
    if (!am) return NextResponse.json({ error: 'Area manager not found' }, { status: 404 });
    if (!am.w9StoragePath) return NextResponse.json({ deleted: true });
    try { await deleteW9(am.w9StoragePath); } catch (e) { console.warn('W9 delete failed', e); }
    await db.collection('AreaManager').updateOne(idFilter(id), {
      $set: {
        w9StoragePath: null,
        w9FileName: null,
        w9MimeType: null,
        w9UploadedAt: null,
        w9UploadedBy: null,
        updatedAt: new Date().toISOString(),
      },
    });
    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'W9 delete failed', detail: err?.message }, { status: 500 });
  }
}
