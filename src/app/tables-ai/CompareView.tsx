'use client';

import { useState } from 'react';
import type { CompareResult, ComparePair, CompareCategory, FieldDiff } from '@/lib/ai-jobs/types';

const CATEGORY_LABELS: Record<CompareCategory, string> = {
  'matched-clean': 'Matched · clean',
  'matched-mismatch': 'Matched · mismatch',
  'ai-only': 'AI-only (bot invented)',
  'production-only': 'Production-only (bot missed)',
};
const CATEGORY_COLORS: Record<CompareCategory, string> = {
  'matched-clean': '#34d399',
  'matched-mismatch': '#fbbf24',
  'ai-only': '#f87171',
  'production-only': '#60a5fa',
};

const fmt = (v: unknown, kind?: string) => {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'money') return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return String(v);
};

export function CompareView() {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState(today);
  const [data, setData] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<CompareCategory>('matched-mismatch');

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams();
      if (start) p.set('startDate', start);
      if (end) p.set('endDate', end);
      const res = await fetch(`/api/ai-jobs/compare?${p.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as CompareResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Compare failed');
    } finally {
      setLoading(false);
    }
  };

  const pairs = (data?.pairs ?? []).filter((p) => p.category === active);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>
          From<br />
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>
          To<br />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
        </label>
        <button type="button" onClick={run} disabled={loading} style={runBtnStyle}>
          {loading ? 'Comparing…' : 'Run comparison'}
        </button>
        <span style={{ fontSize: 11, color: '#64748b' }}>Bot (aiOriginal) vs production Tables · read-only</span>
      </div>

      {err && <div style={{ color: '#f87171', marginBottom: 12 }}>{err}</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {(Object.keys(CATEGORY_LABELS) as CompareCategory[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActive(c)}
                style={{
                  padding: '8px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${active === c ? CATEGORY_COLORS[c] : 'rgba(255,255,255,0.12)'}`,
                  background: active === c ? 'rgba(255,255,255,0.06)' : 'transparent',
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 700, color: CATEGORY_COLORS[c] }}>{data.counts[c] ?? 0}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{CATEGORY_LABELS[c]}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pairs.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>No jobs in this category.</div>}
            {pairs.map((p) => (
              <PairCard key={`${p.aiJobId}_${p.prodJobId}`} pair={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PairCard({ pair }: { pair: ComparePair }) {
  const [open, setOpen] = useState(pair.category === 'matched-mismatch');
  const ident = pair.ai ?? pair.production ?? {};
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', cursor: pair.diffs.length ? 'pointer' : 'default' }} onClick={() => pair.diffs.length && setOpen((o) => !o)}>
        <span style={{ fontWeight: 600 }}>{(ident as any).clientName || (ident as any).address || '(no name)'}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{(ident as any).date ?? ''} · {(ident as any).tech ?? ''}</span>
        {pair.prodJobId && pair.aiJobId && (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            match: {pair.matchBy} · confidence {(pair.confidence * 100).toFixed(0)}%
          </span>
        )}
        {pair.mismatchCount > 0 && (
          <span style={{ fontSize: 11, marginLeft: 'auto', color: '#fbbf24' }}>{pair.mismatchCount} field(s) differ</span>
        )}
      </div>

      {open && pair.diffs.length > 0 && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                <th style={th}>Field</th>
                <th style={th}>Production (employee)</th>
                <th style={th}>AI (bot)</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {pair.diffs.map((d: FieldDiff) => (
                <tr key={d.field} style={{ background: d.match ? 'transparent' : 'rgba(251,191,36,0.08)' }}>
                  <td style={td}>{d.label}</td>
                  <td style={td}>{fmt(d.production, d.kind)}</td>
                  <td style={td}>{fmt(d.ai, d.kind)}</td>
                  <td style={{ ...td, color: d.match ? '#34d399' : '#f87171' }}>{d.match ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '6px 8px', color: 'inherit' };
const runBtnStyle: React.CSSProperties = { padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.5)', background: 'rgba(99,102,241,0.25)', color: '#c7d2fe', cursor: 'pointer' };
const th: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' };
const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)' };
