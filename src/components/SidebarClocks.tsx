'use client';

// Live world-clock panel for the sidebar. Ships with Indianapolis, Chicago
// and Israel by default; the user can add more cities (persisted to
// localStorage) or remove any of them. Times tick every second on the client.

import { useEffect, useRef, useState } from 'react';
import { FiPlus, FiX, FiClock } from 'react-icons/fi';

type Clock = { id: string; label: string; tz: string; abbr: string };

const DEFAULT_CLOCKS: Clock[] = [
  { id: 'indianapolis', label: 'Indianapolis', tz: 'America/Indiana/Indianapolis', abbr: 'IND' },
  { id: 'chicago',      label: 'Chicago',      tz: 'America/Chicago',               abbr: 'CHI' },
  { id: 'israel',       label: 'Israel',       tz: 'Asia/Jerusalem',                abbr: 'ISR' },
];

// Curated city list for the "add clock" picker. Each entry carries its IANA
// time zone and a short 3-letter code shown when the sidebar is collapsed.
const TZ_OPTIONS: { label: string; tz: string; abbr: string }[] = [
  { label: 'Indianapolis', tz: 'America/Indiana/Indianapolis', abbr: 'IND' },
  { label: 'Chicago',      tz: 'America/Chicago',              abbr: 'CHI' },
  { label: 'Israel',       tz: 'Asia/Jerusalem',              abbr: 'ISR' },
  { label: 'New York',     tz: 'America/New_York',            abbr: 'NYC' },
  { label: 'Los Angeles',  tz: 'America/Los_Angeles',         abbr: 'LAX' },
  { label: 'Denver',       tz: 'America/Denver',              abbr: 'DEN' },
  { label: 'Phoenix',      tz: 'America/Phoenix',             abbr: 'PHX' },
  { label: 'Mexico City',  tz: 'America/Mexico_City',         abbr: 'MEX' },
  { label: 'São Paulo',    tz: 'America/Sao_Paulo',           abbr: 'SAO' },
  { label: 'London',       tz: 'Europe/London',              abbr: 'LON' },
  { label: 'Paris',        tz: 'Europe/Paris',               abbr: 'PAR' },
  { label: 'Dubai',        tz: 'Asia/Dubai',                 abbr: 'DXB' },
  { label: 'India',        tz: 'Asia/Kolkata',               abbr: 'IND' },
  { label: 'Manila',       tz: 'Asia/Manila',                abbr: 'MNL' },
  { label: 'Tokyo',        tz: 'Asia/Tokyo',                 abbr: 'TYO' },
  { label: 'Sydney',       tz: 'Australia/Sydney',           abbr: 'SYD' },
];

const STORAGE_KEY = 'sidebar-clocks-v1';

function loadClocks(): Clock[] {
  if (typeof window === 'undefined') return DEFAULT_CLOCKS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CLOCKS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((c) => c && c.tz && c.label)) return parsed;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_CLOCKS;
}

function fmtTime(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return '—';
  }
}

export default function SidebarClocks({ collapsed }: { collapsed: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());
  const [clocks, setClocks] = useState<Clock[]>(DEFAULT_CLOCKS);
  const [adding, setAdding] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Hydrate from storage + start the per-second tick (client only).
  useEffect(() => {
    setMounted(true);
    setClocks(loadClocks());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Persist whenever the list changes (after the initial hydrate).
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clocks));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [clocks, mounted]);

  // Close the add-picker when clicking outside it.
  useEffect(() => {
    if (!adding) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setAdding(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [adding]);

  const addClock = (opt: { label: string; tz: string; abbr: string }) => {
    setClocks((prev) => [
      ...prev,
      { id: `${opt.tz}-${prev.length}-${opt.label}`, label: opt.label, tz: opt.tz, abbr: opt.abbr },
    ]);
    setAdding(false);
  };

  const removeClock = (id: string) => setClocks((prev) => prev.filter((c) => c.id !== id));

  // Avoid SSR/CSR mismatch: render a stable placeholder until mounted.
  const timeFor = (tz: string) => (mounted ? fmtTime(now, tz) : '—');

  // ── Collapsed: compact stack of abbr + time, no controls ──
  if (collapsed) {
    return (
      <div
        className="flex-shrink-0 px-1 py-2 space-y-1.5"
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
      >
        {clocks.map((c) => (
          <div key={c.id} className="flex flex-col items-center leading-tight" title={`${c.label} — ${timeFor(c.tz)}`}>
            <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: '#475569' }}>{c.abbr}</span>
            <span className="text-[10px] font-medium text-slate-300">{timeFor(c.tz)}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── Expanded: full rows + add button + picker ──
  return (
    <div
      className="flex-shrink-0 px-2 py-3"
      style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#475569' }}>
          <FiClock size={11} /> Clocks
        </span>
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            title="Add a clock"
            className="flex h-5 w-5 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <FiPlus size={13} />
          </button>
          {adding && (
            <div
              className="absolute bottom-7 right-0 z-50 max-h-64 w-44 overflow-y-auto rounded-xl py-1 shadow-2xl"
              style={{ background: '#0d1526', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {TZ_OPTIONS.map((opt) => (
                <button
                  key={opt.tz + opt.label}
                  type="button"
                  onClick={() => addClock(opt)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <span className="truncate">{opt.label}</span>
                  <span className="flex-shrink-0 text-[10px] tabular-nums" style={{ color: '#64748b' }}>{timeFor(opt.tz)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
        {clocks.map((c) => (
          <div key={c.id} className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1">
            <span className="truncate text-xs font-medium text-slate-400">{c.label}</span>
            <span className="flex items-center gap-1">
              <span className="text-xs font-semibold tabular-nums text-slate-200">{timeFor(c.tz)}</span>
              <button
                type="button"
                onClick={() => removeClock(c.id)}
                title={`Remove ${c.label}`}
                className="flex h-4 w-4 items-center justify-center rounded text-slate-600 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
              >
                <FiX size={12} />
              </button>
            </span>
          </div>
        ))}
        {clocks.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-slate-600">No clocks. Tap + to add one.</p>
        )}
      </div>
    </div>
  );
}
