'use client';

// Side-by-side comparison for the Stats page. Two independent filter sets (A and
// B) — each with its own dates / tech / location / provider — are fetched from
// the SAME /api/stats endpoint and rendered next to each other with deltas, so
// you can compare two date ranges, two technicians, two providers, etc. at once.

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../utils/jobUtils';
import type { Technician, Location, Provider } from '@/types/job';
import { FilterField } from '@/components/FiltersPanel';
import MultiSelect from '@/components/MultiSelect';
import DateRangePicker from '@/components/DateRangePicker';

interface Summary {
  count: number;
  totalAmount: number;
  totalPaid: number;
  totalProfit: number;
  jobsProfit: number;
  avgTicket: number;
  avgTicketWithoutPenalty: number;
  avgClosedTicket: number;
  closedRatio: number;
}
interface StatsResponse { summary: Summary }

interface SideFilters {
  startDate: string;
  endDate: string;
  techs: string[];
  locations: string[];
  providers: string[];
}

type Fmt = 'money' | 'pct' | 'num';
const METRICS: { key: keyof Summary; label: string; fmt: Fmt }[] = [
  { key: 'count', label: 'Jobs', fmt: 'num' },
  { key: 'closedRatio', label: 'Closed ratio', fmt: 'pct' },
  { key: 'jobsProfit', label: 'Jobs profit', fmt: 'money' },
  { key: 'totalProfit', label: 'Total profit', fmt: 'money' },
  { key: 'totalPaid', label: 'Total collected', fmt: 'money' },
  { key: 'totalAmount', label: 'Total sales', fmt: 'money' },
  { key: 'avgClosedTicket', label: 'Avg closed ticket', fmt: 'money' },
  { key: 'avgTicket', label: 'Avg ticket', fmt: 'money' },
  { key: 'avgTicketWithoutPenalty', label: 'Avg w/o penalty', fmt: 'money' },
];

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const today = fmtDate(new Date());
const thirtyAgo = fmtDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
const sixtyAgo = fmtDate(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));
const thirtyOneAgo = fmtDate(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));

const fmtVal = (fmt: Fmt, v: number) =>
  fmt === 'money' ? formatCurrency(v) : fmt === 'pct' ? `${(v * 100).toFixed(1)}%` : Math.round(v).toLocaleString();

function describe(f: SideFilters): string {
  const parts: string[] = [];
  if (f.techs.length) parts.push(`Tech: ${f.techs.join(', ')}`);
  if (f.providers.length) parts.push(`Provider: ${f.providers.join(', ')}`);
  if (f.locations.length) parts.push(`Location: ${f.locations.join(', ')}`);
  parts.push(`${f.startDate} → ${f.endDate}`);
  return parts.join(' · ');
}

function queryFor(f: SideFilters): string {
  const p = new URLSearchParams();
  if (f.startDate) p.set('startDate', f.startDate);
  if (f.endDate) p.set('endDate', f.endDate);
  f.techs.forEach((t) => p.append('tech', t));
  f.locations.forEach((l) => p.append('location', l));
  f.providers.forEach((pr) => p.append('provider', pr));
  return p.toString();
}

export default function StatsCompare({
  lookups,
}: {
  lookups: { techs: Technician[]; locations: Location[]; providers: Provider[] };
}) {
  const techOpts = lookups.techs.map((t) => t._id);
  const locOpts = lookups.locations.map((l) => l._id);
  const provOpts = lookups.providers.map((p) => p._id);

  // Sensible defaults: A = last 30 days, B = the 30 days before that.
  const [a, setA] = useState<SideFilters>({ startDate: thirtyAgo, endDate: today, techs: [], locations: [], providers: [] });
  const [b, setB] = useState<SideFilters>({ startDate: sixtyAgo, endDate: thirtyOneAgo, techs: [], locations: [], providers: [] });

  const [active, setActive] = useState<{ a: SideFilters; b: SideFilters } | null>(null);
  const [statsA, setStatsA] = useState<Summary | null>(null);
  const [statsB, setStatsB] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRun = useRef(true);

  const run = async () => {
    const nextActive = { a, b };
    setActive(nextActive);
    setLoading(true);
    setError(null);
    try {
      const [ra, rb] = await Promise.all([
        fetch(`/api/stats?${queryFor(a)}`),
        fetch(`/api/stats?${queryFor(b)}`),
      ]);
      if (!ra.ok || !rb.ok) throw new Error('Failed to load comparison');
      const [da, db] = (await Promise.all([ra.json(), rb.json()])) as [StatsResponse, StatsResponse];
      setStatsA(da.summary);
      setStatsB(db.summary);
      sessionStorage.setItem('stats-compare', JSON.stringify(nextActive));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comparison');
    } finally {
      setLoading(false);
    }
  };

  // Restore saved sides + run once on mount.
  useEffect(() => {
    if (!firstRun.current) return;
    firstRun.current = false;
    const saved = sessionStorage.getItem('stats-compare');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { a: SideFilters; b: SideFilters };
        if (parsed?.a && parsed?.b) { setA(parsed.a); setB(parsed.b); }
      } catch { /* ignore */ }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    if (!statsA || !statsB) return [];
    return METRICS.map((m) => {
      const av = Number(statsA[m.key] ?? 0);
      const bv = Number(statsB[m.key] ?? 0);
      const delta = bv - av;
      const pct = av !== 0 ? (delta / Math.abs(av)) * 100 : bv !== 0 ? 100 : 0;
      return { ...m, av, bv, delta, pct };
    });
  }, [statsA, statsB]);

  const SideFilterCard = ({ label, f, set, color }: { label: string; f: SideFilters; set: (v: SideFilters) => void; color: string }) => (
    <div className="panel" style={{ padding: 16, flex: 1, minWidth: 280, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>{label}</span>
        <strong style={{ fontSize: 14 }}>Set {label}</strong>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <FilterField label="Dates">
          <DateRangePicker startDate={f.startDate} endDate={f.endDate} onChange={(s, e) => set({ ...f, startDate: s, endDate: e })} />
        </FilterField>
        <FilterField label="Tech">
          <MultiSelect options={techOpts} selected={f.techs} onChange={(v) => set({ ...f, techs: v })} placeholder="All" allLabel="All" />
        </FilterField>
        <FilterField label="Location">
          <MultiSelect options={locOpts} selected={f.locations} onChange={(v) => set({ ...f, locations: v })} placeholder="All" allLabel="All" />
        </FilterField>
        <FilterField label="Provider">
          <MultiSelect options={provOpts} selected={f.providers} onChange={(v) => set({ ...f, providers: v })} placeholder="All" allLabel="All" />
        </FilterField>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <SideFilterCard label="A" f={a} set={setA} color="#6366f1" />
        <SideFilterCard label="B" f={b} set={setB} color="#f59e0b" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="portal-btn portal-btn-primary" onClick={run} disabled={loading}
          style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 20px', fontWeight: 700, cursor: 'pointer' }}>
          {loading ? 'Comparing…' : 'Compare'}
        </button>
      </div>

      {error && <div className="panel" style={{ padding: 14, color: '#f87171' }}>{error}</div>}

      {active && statsA && statsB && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Metric</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>
                    <span style={dot('#6366f1')} /> A
                    <div style={subHead}>{describe(active.a)}</div>
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>
                    <span style={dot('#f59e0b')} /> B
                    <div style={subHead}>{describe(active.b)}</div>
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Δ (B − A)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const up = r.delta > 0.0001;
                  const down = r.delta < -0.0001;
                  const col = up ? '#34d399' : down ? '#f87171' : '#94a3b8';
                  const deltaStr = r.fmt === 'pct'
                    ? `${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(1)}pp`
                    : `${r.delta >= 0 ? '+' : ''}${fmtVal(r.fmt, r.delta)}`;
                  return (
                    <tr key={String(r.key)} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={tdStyle}>{r.label}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtVal(r.fmt, r.av)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtVal(r.fmt, r.bv)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: col, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {deltaStr}
                        {r.fmt !== 'pct' && <span style={{ opacity: 0.7, fontWeight: 500 }}> ({r.pct >= 0 ? '+' : ''}{r.pct.toFixed(0)}%)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.1)', verticalAlign: 'top' };
const tdStyle: React.CSSProperties = { padding: '11px 16px', color: '#e2e8f0' };
const subHead: React.CSSProperties = { fontSize: 10, color: '#64748b', fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginTop: 3, maxWidth: 240, whiteSpace: 'normal', marginLeft: 'auto' };
const dot = (c: string): React.CSSProperties => ({ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 6 });
