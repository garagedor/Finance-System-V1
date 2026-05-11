import { NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../../lib/supabase-server';

// GET — combined state for the Week Control page:
//   - currentWeek: { week_start, week_end, allowed, is_locked, opens_at, open_hour, open_minute, ... }
//   - locks: rows from week_locks
//   - weeks: distinct week_start values from weekly_reports
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const supa = await getSupabaseServerClient();

    const [{ data: rpcRows, error: rpcErr }, { data: locks, error: locksErr }, { data: reportWeeks, error: weeksErr }] = await Promise.all([
      supa.rpc('indiana_current_week'),
      supa.from('week_locks').select('week_start, locked_at, locked_by, note').order('week_start', { ascending: false }),
      supa.from('weekly_reports').select('week_start').order('week_start', { ascending: false }),
    ]);
    if (rpcErr) throw rpcErr;
    if (locksErr) throw locksErr;
    if (weeksErr) throw weeksErr;

    const seen = new Set<string>();
    const weeks: string[] = [];
    (reportWeeks || []).forEach((r: any) => {
      const w = r.week_start;
      if (w && !seen.has(w)) { seen.add(w); weeks.push(w); }
    });

    return NextResponse.json({
      currentWeek: Array.isArray(rpcRows) ? (rpcRows[0] || null) : rpcRows,
      locks: locks || [],
      weeks,
    });
  } catch (err: any) {
    console.error('GET /api/verify/week/state error', err);
    return NextResponse.json({ error: 'Failed to load week state', detail: err?.message || String(err) }, { status: 500 });
  }
}
