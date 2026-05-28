import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { requirePermission } from '@/lib/rbac';

const MONGODB_URI = 'mongodb+srv://garagedoorcrm_db_user:ONTt9lY8NvV3Ayvn@cluster0.4jpiqpk.mongodb.net';
const DB_NAME = 'ag';

let cachedClient: MongoClient | null = null;
async function getClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const c = new MongoClient(MONGODB_URI);
  await c.connect();
  cachedClient = c;
  return c;
}

const idFilter = (id: string): any => {
  if (ObjectId.isValid(id) && id.length === 24) return { _id: new ObjectId(id) };
  return { _id: id };
};

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const session = await requirePermission('finance:area_managers:edit');
  if (session instanceof NextResponse) return session;
  try {
    const { id, paymentId } = await params;
    const client = await getClient();
    const col = client.db(DB_NAME).collection('AreaManagerPayment');
    const res = await col.deleteOne({
      ...idFilter(paymentId),
      areaManagerId: String(id),
    });
    if (res.deletedCount === 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to delete payment', detail: err?.message }, { status: 500 });
  }
}
