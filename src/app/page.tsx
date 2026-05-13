'use client';

import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { FiBriefcase, FiTrendingUp, FiAlertTriangle, FiPackage, FiAward, FiCreditCard, FiDollarSign, FiRefreshCw } from 'react-icons/fi';
import DateRangePicker from '@/components/DateRangePicker';
import FiltersPanel, { FilterField } from '@/components/FiltersPanel';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/components/AuthShell';
import { formatCurrency } from './utils/jobUtils';

type DashboardData = {
  jobsByLocation: Array<{ _id: string; count: number }>;
  techStats: Array<{ tech: string; avgTicket: number; closedPct: number; count: number }>;
  locationStats: Array<{ location: string; avgTicket: number; closedPct: number; count: number }>;
  companyPenaltyLoss: Array<{ _id: string; totalPenaltyLoss: number; count?: number }>;
  companyNetProfit: Array<{ _id: string; totalNetProfit: number; count?: number }>;
  totalCompanyParts: Array<{ _id: string; totalParts: number; count?: number }>;
  cardFeeProfit?: Array<{ _id: any; totalCardFeeProfit: number; count?: number }>;
  totalSales?: Array<{ _id: any; totalSales: number; count?: number }>;
};

export default function HomePage() {
  const { user } = useAuth();

  // Input State
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Applied State (Triggers Fetch)
  const [appliedStart, setAppliedStart] = useState(startDate);
  const [appliedEnd, setAppliedEnd] = useState(endDate);
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem('home-filters');
    if (saved) {
      try {
        const { start, end } = JSON.parse(saved);
        if (start) { setStartDate(start); setAppliedStart(start); }
        if (end)   { setEndDate(end);     setAppliedEnd(end);     }
      } catch (e) {
        console.error('Failed to parse saved home filters', e);
      }
    }
    setIsInitialized(true);
  }, []);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const lastFetchRef = useRef<string | null>(null);

  // Admin/Location Manager Check
  if (!user || (user.type !== 'admin' && user.type !== 'location-manager')) {
    return (
      <div className="flex h-[60vh] items-center justify-center px-6">
        <EmptyState
          size="lg"
          icon={
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="8" stroke="#f87171" strokeWidth="1.5"/>
              <line x1="10" y1="6" x2="10" y2="10.5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="10" cy="13" r="0.75" fill="#f87171"/>
            </svg>
          }
          title="Access Denied"
          message="Admin privileges required to view this page."
        />
      </div>
    );
  }

  const fetchData = async () => {
    const search = new URLSearchParams();
    if (appliedStart) search.set('startDate', appliedStart);
    if (appliedEnd)   search.set('endDate',   appliedEnd);
    const fetchKey = search.toString();

    if (lastFetchRef.current === fetchKey) return;
    lastFetchRef.current = fetchKey;

    setLoading(true);
    try {
      const res = await fetch(`/api/home-stats?${fetchKey}`);
      if (lastFetchRef.current !== fetchKey) return;

      if (res.ok) {
        const json = await res.json();
        setData(json);
        setFiltersDirty(false);
      }
    } catch (error) {
      console.error('Failed to fetch stats', error);
    } finally {
      if (lastFetchRef.current === fetchKey) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isInitialized) fetchData();
  }, [appliedStart, appliedEnd, isInitialized]);

  const handleApply = () => {
    setError(null);
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setFiltersDirty(false);

    lastFetchRef.current = null;
    fetchData();

    sessionStorage.setItem('home-filters', JSON.stringify({
      start: startDate, end: endDate,
    }));
  };

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setFiltersDirty(true);
    setError(null);
  };

  // Display-only date formatter
  const fmtDate = (s: string) =>
    s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  // ── Derived KPI sums (display-only, from existing data arrays) ──
  const kpis = useMemo(() => {
    if (!data) return null;
    const totalJobs    = data.jobsByLocation.reduce((s, l) => s + (l.count || 0), 0);
    const totalProfit  = data.companyNetProfit.reduce((s, l) => s + (l.totalNetProfit || 0), 0);
    const totalPenalty = data.companyPenaltyLoss.reduce((s, l) => s + (l.totalPenaltyLoss || 0), 0);
    const totalParts   = data.totalCompanyParts.reduce((s, l) => s + (l.totalParts || 0), 0);
    const cardFeeProfit = (data.cardFeeProfit || []).reduce((s, r) => s + (r.totalCardFeeProfit || 0), 0);
    const totalSales   = (data.totalSales || []).reduce((s, r) => s + (r.totalSales || 0), 0);
    // Per-KPI underlying job counts (basis-of-calculation).
    const profitJobs   = data.companyNetProfit.reduce((s, l) => s + (l.count || 0), 0);
    const penaltyJobs  = data.companyPenaltyLoss.reduce((s, l) => s + (l.count || 0), 0);
    const partsJobs    = data.totalCompanyParts.reduce((s, l) => s + (l.count || 0), 0);
    const cardFeeJobs  = (data.cardFeeProfit || []).reduce((s, r) => s + (r.count || 0), 0);
    const salesJobs    = (data.totalSales || []).reduce((s, r) => s + (r.count || 0), 0);
    return { totalJobs, totalSales, totalProfit, totalPenalty, totalParts, cardFeeProfit, salesJobs, profitJobs, penaltyJobs, partsJobs, cardFeeJobs };
  }, [data]);

  // ── Initial skeleton ──
  if (!data && loading && !appliedStart) {
    return (
      <div className="min-h-screen pb-16">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div className="h-12 w-56 rounded-xl shimmer-bg" />
          <div className="h-20 rounded-2xl border border-white/8 bg-[#111827] shimmer-bg" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl border border-white/8 bg-[#111827] shimmer-bg" />
            ))}
          </div>
          <div className="h-[316px] rounded-2xl border border-white/8 bg-[#111827] shimmer-bg" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-72 rounded-2xl border border-white/8 bg-[#111827] shimmer-bg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[60vh] items-center justify-center px-6">
        <EmptyState size="lg" title="No data loaded" message="Try refreshing or adjusting the date range." />
      </div>
    );
  }

  // ── Sorted leaderboards ──
  const techAvgTicketCtx  = [...(data.techStats || [])].sort((a, b) => b.avgTicket - a.avgTicket);
  const locAvgTicketCtx   = [...(data.locationStats || [])].sort((a, b) => b.avgTicket - a.avgTicket);
  const techClosedPctCtx  = [...(data.techStats || [])].sort((a, b) => b.closedPct - a.closedPct);
  const locClosedPctCtx   = [...(data.locationStats || [])].sort((a, b) => b.closedPct - a.closedPct);

  // Per-location assigned-job counts, used by Company Financial cards to show
  // "$X · N jobs" next to each location row.
  const jobsByLocation: Record<string, number> = (data.jobsByLocation || []).reduce(
    (acc, l) => ({ ...acc, [l._id]: l.count || 0 }),
    {} as Record<string, number>
  );

  return (
    <main className="relative min-h-screen pb-16">
      {/* Refetch indicator */}
      {loading && data && <div className="top-progress" />}

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* ── PAGE HEADER ── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-up">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-400">Overview</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">
              {fmtDate(appliedStart)} <span className="text-slate-700 mx-1">→</span> {fmtDate(appliedEnd)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <div className="flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-medium text-indigo-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                Updating
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              title="Hard refresh — reload the page from the server, bypassing the browser cache"
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <FiRefreshCw size={12} />
              Hard Refresh
            </button>
          </div>
        </div>

        {/* ── STICKY FILTER BAR ── */}
        <div
          className="sticky top-0 z-30 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 py-2"
          style={{ background: 'rgba(10,15,28,0.85)', backdropFilter: 'blur(12px)' }}
        >
          <FiltersPanel
            direction="horizontal"
            loading={loading}
            filtersDirty={filtersDirty}
            onApply={handleApply}
            error={error}
          >
            <FilterField label="Date Range">
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onChange={handleDateChange}
              />
            </FilterField>
          </FiltersPanel>
        </div>

        {/* ── HERO KPI STRIP ── */}
        {kpis && (
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-6 stagger">
            <KpiCard
              label="Total Jobs"
              value={String(kpis.totalJobs)}
              icon={<FiBriefcase size={16} />}
              accent="indigo"
            />
            <KpiCard
              label="Total Sales"
              value={formatCurrency(kpis.totalSales)}
              icon={<FiDollarSign size={16} />}
              accent="emerald"
              jobCount={kpis.salesJobs}
            />
            <KpiCard
              label="Net Profit"
              value={formatCurrency(kpis.totalProfit)}
              icon={<FiTrendingUp size={16} />}
              accent={kpis.totalProfit >= 0 ? 'emerald' : 'red'}
              jobCount={kpis.profitJobs}
            />
            <KpiCard
              label="Penalty Loss"
              value={formatCurrency(kpis.totalPenalty)}
              icon={<FiAlertTriangle size={16} />}
              accent="amber"
              jobCount={kpis.penaltyJobs}
            />
            <KpiCard
              label="Parts Total"
              value={formatCurrency(kpis.totalParts)}
              icon={<FiPackage size={16} />}
              accent="cyan"
              jobCount={kpis.partsJobs}
            />
            <KpiCard
              label="Card Fee Profit"
              value={formatCurrency(kpis.cardFeeProfit)}
              icon={<FiCreditCard size={16} />}
              accent="violet"
              jobCount={kpis.cardFeeJobs}
            />
          </section>
        )}

        {/* ── CHART ── */}
        <section className="animate-fade-up">
          <SectionHeading kicker="Distribution" title="Jobs by Location" />
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#111827] shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
            <div className="h-[300px] px-4 py-5">
              {data.jobsByLocation && data.jobsByLocation.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.jobsByLocation} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#6366f1" stopOpacity={1} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.45} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="_id" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={8} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                    <Tooltip
                      cursor={{ fill: 'rgba(99,102,241,0.08)' }}
                      contentStyle={{
                        borderRadius: '12px',
                        background: '#1a2236',
                        border: '1px solid rgba(255,255,255,0.1)',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#f1f5f9',
                      }}
                      labelStyle={{ color: '#94a3b8' }}
                      itemStyle={{ color: '#f1f5f9' }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={36} fill="url(#barFill)" animationDuration={650} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <EmptyState size="sm" title="No jobs found" message="Try adjusting your date range." />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── PERFORMANCE LEADERBOARDS ── */}
        <section className="animate-fade-up" style={{ animationDelay: '60ms' }}>
          <SectionHeading kicker="Performance" title="Tech & Location Metrics" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 stagger">
            <LeaderboardCard
              title="Tech Average Ticket"
              items={techAvgTicketCtx}
              keyProp="tech"
              valueProp="avgTicket"
              formatValue={formatCurrency}
              thresholds={{ red: 400, green: 600 }}
            />
            <LeaderboardCard
              title="Location Avg Ticket"
              items={locAvgTicketCtx}
              keyProp="location"
              valueProp="avgTicket"
              formatValue={formatCurrency}
              thresholds={{ red: 400, green: 600 }}
            />
            <LeaderboardCard
              title="Tech Closed %"
              items={techClosedPctCtx}
              keyProp="tech"
              valueProp="closedPct"
              formatValue={(v) => `${Math.round(v)}%`}
              thresholds={{ red: 45, green: 60 }}
            />
            <LeaderboardCard
              title="Location Closed %"
              items={locClosedPctCtx}
              keyProp="location"
              valueProp="closedPct"
              formatValue={(v) => `${Math.round(v)}%`}
              thresholds={{ red: 45, green: 60 }}
            />
          </div>
        </section>

        {/* ── FINANCIALS ── */}
        <section className="animate-fade-up" style={{ animationDelay: '120ms' }}>
          <SectionHeading kicker="Financial Summary" title="Company Financials" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 stagger">
            <FinancialCard
              title="Penalty Loss"
              subtitle="X-Close penalties"
              items={data.companyPenaltyLoss || []}
              valueProp="totalPenaltyLoss"
              tone="red"
              jobsByKey={jobsByLocation}
            />
            <FinancialCard
              title="Net Profit"
              subtitle="Closed jobs"
              items={data.companyNetProfit || []}
              valueProp="totalNetProfit"
              tone="emerald"
              jobsByKey={jobsByLocation}
            />
            <FinancialCard
              title="Parts Total"
              subtitle="All locations"
              items={data.totalCompanyParts || []}
              valueProp="totalParts"
              tone="cyan"
              jobsByKey={jobsByLocation}
            />
          </div>
        </section>

      </div>
    </main>
  );
}

/* ────────────── KPI CARD ────────────── */

type Accent = 'indigo' | 'emerald' | 'red' | 'amber' | 'cyan' | 'violet';

const accentMap: Record<Accent, { ring: string; glow: string; icon: string; bg: string }> = {
  indigo:  { ring: 'rgba(99,102,241,0.25)',  glow: 'rgba(99,102,241,0.12)',  icon: '#a5b4fc', bg: 'rgba(99,102,241,0.08)' },
  emerald: { ring: 'rgba(16,185,129,0.25)',  glow: 'rgba(16,185,129,0.10)',  icon: '#34d399', bg: 'rgba(16,185,129,0.08)' },
  red:     { ring: 'rgba(239,68,68,0.25)',   glow: 'rgba(239,68,68,0.10)',   icon: '#f87171', bg: 'rgba(239,68,68,0.08)'  },
  amber:   { ring: 'rgba(245,158,11,0.25)',  glow: 'rgba(245,158,11,0.10)',  icon: '#fbbf24', bg: 'rgba(245,158,11,0.08)' },
  cyan:    { ring: 'rgba(6,182,212,0.25)',   glow: 'rgba(6,182,212,0.10)',   icon: '#22d3ee', bg: 'rgba(6,182,212,0.08)'  },
  violet:  { ring: 'rgba(139,92,246,0.25)',  glow: 'rgba(139,92,246,0.12)',  icon: '#c4b5fd', bg: 'rgba(139,92,246,0.08)' },
};

function KpiCard({
  label, value, icon, accent, jobCount,
}: { label: string; value: string; icon: React.ReactNode; accent: Accent; jobCount?: number }) {
  const a = accentMap[accent];
  return (
    <div
      className="hover-lift group relative overflow-hidden rounded-2xl border bg-[#111827] p-5 shadow-[0_4px_18px_rgba(0,0,0,0.3)]"
      style={{ borderColor: 'rgba(255,255,255,0.07)' }}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-60 transition-opacity group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, ${a.glow} 0%, transparent 70%)` }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-white truncate">{value}</p>
          {typeof jobCount === 'number' && (
            <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
              {jobCount} {jobCount === 1 ? 'job' : 'jobs'}
            </p>
          )}
        </div>
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
          style={{ background: a.bg, color: a.icon, border: `1px solid ${a.ring}` }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ────────────── SECTION HEADING ────────────── */

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-3 px-1">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-400">{kicker}</p>
      <h2 className="text-base font-bold text-slate-100">{title}</h2>
    </div>
  );
}

/* ────────────── LEADERBOARD CARD ────────────── */

function LeaderboardCard({
  title, items, keyProp, valueProp, formatValue, thresholds,
}: {
  title: string;
  items: any[];
  keyProp: string;
  valueProp: string;
  formatValue: (v: number) => string | number;
  thresholds?: { red: number; green: number };
}) {
  const maxValue = items.length ? Math.max(...items.map(i => i[valueProp] || 0), 1) : 1;

  return (
    <div className="hover-lift flex h-full flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#111827] shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
      <div className="border-b border-white/5 px-5 py-3.5">
        <h3 className="text-sm font-bold tracking-tight text-slate-100">{title}</h3>
      </div>

      {!items.length ? (
        <div className="flex-1 flex items-center justify-center py-8">
          <EmptyState size="sm" title="No data" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto" style={{ maxHeight: 300 }}>
          <ul className="py-1">
            {items.map((item, idx) => {
              const val = item[valueProp];
              let tone: 'neutral' | 'good' | 'bad' = 'neutral';
              if (thresholds) {
                if (val < thresholds.red) tone = 'bad';
                else if (val > thresholds.green) tone = 'good';
              }
              const widthPct = Math.max(2, Math.min(100, (val / maxValue) * 100));
              const valueColor =
                tone === 'good' ? 'text-emerald-400' :
                tone === 'bad'  ? 'text-red-400' :
                'text-slate-200';
              const barColor =
                tone === 'good' ? 'rgba(16,185,129,0.18)' :
                tone === 'bad'  ? 'rgba(239,68,68,0.18)' :
                'rgba(99,102,241,0.16)';
              const isTopThree = idx < 3;

              return (
                <li key={idx} className="group relative px-4 py-2.5 transition-colors hover:bg-indigo-500/5">
                  {/* Ranking bar bg */}
                  <div
                    className="absolute left-0 top-0 h-full transition-all duration-500"
                    style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, ${barColor}, transparent)` }}
                  />
                  <div className="relative flex items-center gap-3">
                    {/* Rank badge */}
                    <div
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums ${
                        isTopThree
                          ? 'text-amber-300'
                          : 'text-slate-600'
                      }`}
                      style={isTopThree ? {
                        background: 'rgba(245,158,11,0.12)',
                        border: '1px solid rgba(245,158,11,0.25)',
                      } : undefined}
                    >
                      {idx + 1}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-200">
                      {item[keyProp]}
                    </span>
                    {typeof item.count === 'number' && (
                      <span className="flex-shrink-0 text-[11px] font-medium tabular-nums text-slate-500">
                        {item.count} {item.count === 1 ? 'job' : 'jobs'}
                      </span>
                    )}
                    <span className={`flex-shrink-0 text-[13px] font-bold tabular-nums ${valueColor}`}>
                      {formatValue(val)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ────────────── FINANCIAL CARD ────────────── */

function FinancialCard({
  title, subtitle, items, valueProp, tone, jobsByKey,
}: {
  title: string;
  subtitle: string;
  items: any[];
  valueProp: string;
  tone: 'emerald' | 'red' | 'cyan';
  jobsByKey?: Record<string, number>;
}) {
  const total = items.reduce((s, item) => s + (item[valueProp] || 0), 0);
  // Sort the per-location breakdown highest → lowest by the displayed value.
  const sortedItems = [...items].sort((a, b) => (b[valueProp] || 0) - (a[valueProp] || 0));
  const a = accentMap[tone];

  return (
    <div className="hover-lift overflow-hidden rounded-2xl border border-white/8 bg-[#111827] shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
      {/* Top section: total prominent */}
      <div
        className="relative px-5 py-5"
        style={{ background: `linear-gradient(135deg, ${a.bg}, transparent)` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-white">
              {formatCurrency(total)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600">{subtitle}</p>
          </div>
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
            style={{ background: a.bg, color: a.icon, border: `1px solid ${a.ring}` }}
          >
            <FiAward size={16} />
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="border-t border-white/5">
        {!items.length ? (
          <div className="py-6">
            <EmptyState size="sm" title="No breakdown" />
          </div>
        ) : (
          <ul className="overflow-y-auto" style={{ maxHeight: 200 }}>
            {sortedItems.map((item, idx) => {
              const jobCount = jobsByKey?.[item._id];
              return (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-2.5 last:border-0 transition-colors hover:bg-indigo-500/5"
                >
                  <span className="text-[13px] font-medium text-slate-300">{item._id}</span>
                  <div className="flex items-center gap-3">
                    {typeof jobCount === 'number' && (
                      <span className="text-[11px] font-medium tabular-nums text-slate-500">
                        {jobCount} {jobCount === 1 ? 'job' : 'jobs'}
                      </span>
                    )}
                    <span className="text-[13px] font-semibold tabular-nums text-slate-100">
                      {formatCurrency(item[valueProp])}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
