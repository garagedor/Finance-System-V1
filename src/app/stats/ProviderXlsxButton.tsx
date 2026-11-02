'use client';

// Owner-only "Provider spreadsheet" on the Statistics page: pick providers for
// the applied date range (pre-selects every provider with ≥ N jobs) and
// download the by-location workbook from /api/stats/provider-xlsx.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Row = { key: string; count: number };

export default function ProviderXlsxButton({ startDate, endDate }: { startDate: string; endDate: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [minJobs, setMinJobs] = useState(55);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The panel is portalled to <body> with fixed positioning: the page header
  // is its own stacking context (fade-up animation), so a panel rendered
  // inside it drew BEHIND the filters and cards below and could not be used.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(16, window.innerWidth - r.right) });
    };
    place();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Provider job counts for the date range only (other page filters ignored —
  // the spreadsheet covers every location and tech).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ startDate, endDate });
    fetch(`/api/stats?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list: Row[] = (d?.byProvider ?? []).map((p: Row) => ({ key: p.key, count: p.count }));
        setRows(list);
        setPicked(new Set(list.filter((p) => p.count >= minJobs).map((p) => p.key)));
      })
      .catch(() => alive && setError('Could not load providers'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startDate, endDate]);

  const selectMin = (n: number) => {
    setMinJobs(n);
    setPicked(new Set(rows.filter((p) => p.count >= n).map((p) => p.key)));
  };
  const toggle = (k: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const download = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ startDate, endDate });
      rows.filter((r) => picked.has(r.key)).forEach((r) => q.append('provider', r.key));
      const res = await fetch(`/api/stats/provider-xlsx?${q.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Providers_Stats_by_Location_${startDate}_to_${endDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  };

  const btn: React.CSSProperties = {
    background: 'var(--ds-info-wash)', color: 'var(--ds-info-text)', border: '1px solid var(--ds-info-line)',
    borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  };

  return (
    <>
      <button ref={btnRef} type="button" style={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        ⬇ Provider spreadsheet
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal((
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Provider spreadsheet"
          style={{
            position: 'fixed', right: pos.right, top: pos.top, zIndex: 9999, width: 'min(340px, calc(100vw - 32px))',
            maxHeight: `calc(100vh - ${pos.top + 16}px)`, overflowY: 'auto',
            background: 'var(--ds-surface-1)', color: 'var(--ds-ink)', border: '1px solid var(--ds-line-strong)',
            borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.25)', padding: 14,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Provider statistics by location</div>
          <div style={{ fontSize: 12, color: 'var(--ds-ink-2)', marginBottom: 10 }}>
            {startDate} → {endDate} · all locations
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
            Select providers with at least
            <input
              type="number"
              min={1}
              value={minJobs}
              onChange={(e) => selectMin(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 64, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--ds-line-strong)', background: 'var(--ds-surface-2)', color: 'var(--ds-ink)' }}
            />
            jobs
          </label>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--ds-line)', borderRadius: 8 }}>
            {loading ? (
              <div style={{ padding: 10, fontSize: 13 }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 10, fontSize: 13 }}>No jobs in this range.</div>
            ) : rows.map((r) => (
              <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} />
                <span style={{ flex: 1 }}>{r.key}</span>
                <span style={{ color: 'var(--ds-ink-2)' }}>{r.count}</span>
              </label>
            ))}
          </div>
          {error && <div style={{ color: 'var(--ds-crit-text)', fontSize: 12, marginTop: 8 }}>{error}</div>}
          <button
            type="button"
            onClick={download}
            disabled={busy || picked.size === 0}
            style={{ ...btn, width: '100%', marginTop: 10, opacity: busy || picked.size === 0 ? 0.6 : 1, cursor: busy || picked.size === 0 ? 'default' : 'pointer' }}
          >
            {busy ? 'Building… (can take a minute)' : `Download spreadsheet (${picked.size} provider${picked.size === 1 ? '' : 's'})`}
          </button>
        </div>
      ), document.body)}
    </>
  );
}
