// Live settlement balance for one Area Manager.
//
// For each location the AM owns we replay the same Company↔LM math the
// /api/finance route uses (per-location managerProfitPercent × closed-job
// profit + lmParts, minus lmCash + lmCheck + techPaidCash collected under
// the location structure). techPaidCash is included on the AM-owes side
// because the technician sits inside the location structure for cash-
// collection accounting — cash the tech kept is held under the LM and owed
// back to the company. Then we subtract the net of recorded payments to
// land at the open balance.

import { NextRequest, NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';
import { requirePermission } from '@/lib/rbac';
import {
  calcPaidSum, calcPaymentFee, calcParts, calcJobProfit,
  calcStandardShare, toNumber,
} from '@/app/api/utils/calculations';
import type { JobRow, Location } from '@/types/job';
import type { AreaManagerBalance, AreaManagerPayment } from '@/types/areaManager';

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('finance:area_managers:view');
  if (session instanceof NextResponse) return session;
  try {
    const { id } = await params;
    const client = await getClient();
    const db = client.db(DB_NAME);

    const am = await db.collection('AreaManager').findOne(idFilter(id));
    if (!am) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const locationIds: string[] = Array.isArray(am.locationIds) ? am.locationIds.map(String) : [];

    let companyOwesAm = 0;
    let amOwesCompany = 0;

    if (locationIds.length > 0) {
      // Per-location managerProfitPercent map (the AM may own locations with
      // different splits).
      const locs = await db.collection<Location>('Location')
        .find({ _id: { $in: locationIds as any } })
        .toArray();
      const pctByLocation = new Map<string, number>();
      for (const l of locs) pctByLocation.set(String(l._id), toNumber(l.managerProfitPercent));

      const jobs = await db.collection<JobRow>('Job')
        .find({ location: { $in: locationIds as any } })
        .toArray();

      for (const j of jobs) {
        const loc = (j as any).location ? String((j as any).location) : '';
        const pct = pctByLocation.get(loc) ?? 0;
        const status = String((j as any).status || '').toLowerCase();

        const lmCash = toNumber((j as any).lmCash);
        const lmCheck = toNumber((j as any).lmCheck);
        const lmParts = toNumber((j as any).lmParts);
        const techPaidCash = toNumber((j as any).techPaidCash);

        // AM-side: cash + check collected on behalf of company. Includes
        // techPaidCash — the tech sits inside the location structure for
        // cash-collection accounting (matches Balance Report location mode
        // and /api/finance LM↔Company settlement view).
        amOwesCompany += lmCash + lmCheck + techPaidCash;

        // Company-side: profit share on closed jobs + parts reimbursement on any job.
        companyOwesAm += lmParts;
        if (status === 'closed') {
          const paid = calcPaidSum(j as any);
          const fee = calcPaymentFee(j as any);
          const parts = calcParts(j as any);
          const profit = calcJobProfit(paid - fee, parts);
          companyOwesAm += calcStandardShare(profit, pct);
        }
      }
    }

    // Apply recorded payments.
    const payments = await db.collection<AreaManagerPayment>('AreaManagerPayment')
      .find({ areaManagerId: String(am._id) })
      .toArray();
    let netPaid = 0;
    for (const p of payments) {
      const amt = toNumber(p.amount);
      if (p.direction === 'company_to_am') netPaid += amt;
      else if (p.direction === 'am_to_company') netPaid -= amt;
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const balance: AreaManagerBalance = {
      companyOwesAm: round2(companyOwesAm),
      amOwesCompany: round2(amOwesCompany),
      netPaid: round2(netPaid),
      openBalance: round2(companyOwesAm - amOwesCompany - netPaid),
    };
    return NextResponse.json(balance);
  } catch (err: any) {
    console.error('GET /api/area-managers/[id]/balance error', err);
    return NextResponse.json({ error: 'Failed to compute balance', detail: err?.message }, { status: 500 });
  }
}
