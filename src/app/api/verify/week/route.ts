import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '../../../../lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

// All write actions for the Week Control page. Mirrors the edge functions
// invoked by Lovable's AdminSettings.tsx so behavior stays identical.
//
// POST body: { action, ...payload }
//   action = 'open-next'         payload: { force?: boolean }       → invokes open-weekly-reports
//   action = 'force-open-all'                                        → invokes force-open-all-reports
//   action = 'close'             payload: { week_start?: string }    → invokes close-current-week
//   action = 'reopen'            payload: { week_start?: string }    → invokes reopen-week
//
// PUT body: { open_hour, open_minute }                               → updates app_settings

async function invokeEdgeFn<T = any>(supa: SupabaseClient, name: string, body: unknown): Promise<T> {
  const { data, error } = await supa.functions.invoke(name, { body: body ?? {} });
  if (!error) return data as T;
  // Surface real error body when possible (Lovable does the same trick).
  let detail = error.message || 'Edge function error';
  const ctx: any = (error as any).context;
  try {
    if (ctx?.json) {
      const j = await ctx.json();
      if (j?.error) detail = j.error;
      else if (typeof j === 'string') detail = j;
    } else if (ctx?.text) {
      const t = await ctx.text();
      if (t) detail = t;
    }
  } catch { /* ignore */ }
  throw new Error(detail);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const supa = await getSupabaseServerClient();

    switch (action) {
      case 'open-next': {
        const data = await invokeEdgeFn(supa, 'open-weekly-reports', { force: body?.force === true });
        return NextResponse.json({ ok: true, data });
      }
      case 'force-open-all': {
        const data = await invokeEdgeFn(supa, 'force-open-all-reports', {});
        if (data && data.ok === false) {
          throw new Error(data.error || 'Force open failed');
        }
        return NextResponse.json({ ok: true, data });
      }
      case 'close': {
        const week_start = typeof body?.week_start === 'string' ? body.week_start : undefined;
        const data = await invokeEdgeFn(supa, 'close-current-week', week_start ? { week_start } : {});
        if (data && data.ok === false) throw new Error(data.error || 'Close failed');
        return NextResponse.json({ ok: true, data });
      }
      case 'reopen': {
        const week_start = typeof body?.week_start === 'string' ? body.week_start : undefined;
        const data = await invokeEdgeFn(supa, 'reopen-week', week_start ? { week_start } : {});
        if (data && data.ok === false) throw new Error(data.error || 'Reopen failed');
        return NextResponse.json({ ok: true, data });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error('POST /api/verify/week error', err);
    return NextResponse.json({ error: 'Action failed', detail: err?.message || String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const h = Math.max(0, Math.min(23, Math.trunc(Number(body?.open_hour))));
    const m = Math.max(0, Math.min(59, Math.trunc(Number(body?.open_minute))));
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
      return NextResponse.json({ error: 'open_hour and open_minute must be numbers' }, { status: 400 });
    }
    const supa = await getSupabaseServerClient();
    const { error } = await supa.from('app_settings').update({ open_hour: h, open_minute: m }).eq('id', true);
    if (error) throw error;
    return NextResponse.json({ ok: true, open_hour: h, open_minute: m });
  } catch (err: any) {
    console.error('PUT /api/verify/week error', err);
    return NextResponse.json({ error: 'Failed to save open time', detail: err?.message || String(err) }, { status: 500 });
  }
}
