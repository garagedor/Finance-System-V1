// Owner-only: "Provider statistics by location" spreadsheet for a date range.
//   GET ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&provider=A&provider=B…
//   (no provider → every provider with at least minJobs jobs, default 55)
// Numbers come from computeStats, the Statistics page's own aggregation.

import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/rbac';
import { isStatsXlsxOwner } from '@/lib/stats-owner';
import { computeStats } from '@/app/api/stats/route';
import { buildProviderStatsWorkbook, type ProviderStats } from '@/lib/provider-stats-xlsx';

export const runtime = 'nodejs';
// One aggregation per provider and per provider×location — give it room.
export const maxDuration = 120;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await readSession();
  if (!isStatsXlsxOwner(session)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';
  if (!ISO.test(startDate) || !ISO.test(endDate) || startDate > endDate) {
    return NextResponse.json({ error: 'Pick a valid date range' }, { status: 400 });
  }
  try {
    const range = { startDate, endDate };
    let names = Array.from(new Set(searchParams.getAll('provider').map((p) => p.trim()).filter(Boolean)));
    if (names.length === 0) {
      const minJobs = Math.max(1, Number(searchParams.get('minJobs')) || 55);
      const all = await computeStats(range);
      names = all.byProvider.filter((p) => p.count >= minJobs).map((p) => p.key);
    }
    if (names.length === 0) return NextResponse.json({ error: 'No providers in this range' }, { status: 404 });
    if (names.length > 40) return NextResponse.json({ error: 'Too many providers (max 40)' }, { status: 400 });

    const providers: ProviderStats[] = [];
    for (const name of names) {
      const all = await computeStats({ ...range, providers: [name] });
      const byLoc = [];
      for (const l of all.byLocation) {
        byLoc.push({ location: l.key, stats: await computeStats({ ...range, providers: [name], locations: [l.key] }) });
      }
      providers.push({ name, all, byLoc });
    }
    // Biggest provider first, as on the Statistics page.
    providers.sort((a, b) => b.all.summary.count - a.all.summary.count);

    const buf = await buildProviderStatsWorkbook({ startDate, endDate, providers });
    const filename = `Providers_Stats_by_Location_${startDate}_to_${endDate}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('GET /api/stats/provider-xlsx error', err);
    return NextResponse.json({ error: 'Failed to build the spreadsheet' }, { status: 500 });
  }
}
