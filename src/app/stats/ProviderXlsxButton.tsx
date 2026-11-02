'use client';

// Owner-only "Provider spreadsheet" on the Statistics page: pick providers for
// the applied date range (pre-selects every provider with ≥ N jobs) and
// download the by-location workbook from /api/stats/provider-xlsx.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ProviderXlsxButton.css';

type Row = { key: string; count: number };

export default function ProviderXlsxButton({ startDate, endDate }: { startDate: string; endDate: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [minJobs, setMinJobs] = useState(55);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.key.toLowerCase().includes(q)) : rows;
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.key));
  const pickedJobs = rows.reduce((n, r) => n + (picked.has(r.key) ? r.count : 0), 0);
  const selectAll = () => setPicked((s) => new Set([...s, ...shown.map((r) => r.key)]));
  const clearAll = () => setPicked((s) => {
    if (!q) return new Set();
    const next = new Set(s);
    shown.forEach((r) => next.delete(r.key));
    return next;
  });

  return (
    <>
      <button ref={btnRef} type="button" className="pxs-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        ⬇ Provider spreadsheet
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal((
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Provider spreadsheet"
          className="pxs-panel"
          style={{ right: pos.right, top: pos.top, maxHeight: `calc(100vh - ${pos.top + 16}px)` }}
        >
          <div className="pxs-head">
            <div>
              <div className="pxs-title">Provider spreadsheet</div>
              <div className="pxs-sub">{startDate} → {endDate} · all locations</div>
            </div>
            <button type="button" className="pxs-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>

          <div className="pxs-tools">
            <div className="pxs-seg" role="group" aria-label="Quick select">
              <button type="button" onClick={selectAll} disabled={loading || shown.length === 0 || allShownPicked}>Select all</button>
              <button type="button" onClick={clearAll} disabled={loading || picked.size === 0}>Clear</button>
            </div>
            <label className="pxs-min">
              <span>≥</span>
              <input
                type="number"
                min={1}
                value={minJobs}
                onChange={(e) => selectMin(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Select providers with at least this many jobs"
              />
              <span>jobs</span>
            </label>
          </div>

          <input
            className="pxs-search"
            type="search"
            placeholder="Search providers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="pxs-list-head">
            <span>Provider</span>
            <span>Jobs</span>
          </div>
          <div className="pxs-list" role="listbox" aria-multiselectable="true">
            {loading ? (
              <div className="pxs-empty">Loading providers…</div>
            ) : shown.length === 0 ? (
              <div className="pxs-empty">{rows.length === 0 ? 'No jobs in this range.' : 'No provider matches.'}</div>
            ) : shown.map((r) => {
              const on = picked.has(r.key);
              return (
                <label key={r.key} className={`pxs-row${on ? ' is-on' : ''}`} role="option" aria-selected={on}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r.key)} />
                  <span className="pxs-name" title={r.key}>{r.key}</span>
                  <span className="pxs-count">{r.count.toLocaleString()}</span>
                </label>
              );
            })}
          </div>

          {error && <div className="pxs-error">{error}</div>}

          <div className="pxs-foot">
            <div className="pxs-summary">
              <strong>{picked.size}</strong> of {rows.length} providers · {pickedJobs.toLocaleString()} jobs
            </div>
            <button type="button" className="pxs-go" onClick={download} disabled={busy || picked.size === 0}>
              {busy ? 'Building… (up to a minute)' : 'Download spreadsheet'}
            </button>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
