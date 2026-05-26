'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, TooltipProps,
} from 'recharts';
import { FiCreditCard, FiBriefcase, FiTrendingUp, FiPercent, FiLayers } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import DateRangePicker from '@/components/DateRangePicker';
import FiltersPanel, { FilterField } from '@/components/FiltersPanel';
import EmptyState from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import MultiSelect from '@/components/MultiSelect';
import { useFilterRelationships } from '@/hooks/useFilterRelationships';
import { formatCurrency, formatDisplayDate } from '../utils/jobUtils';
import '../balance-report/styles.css';

// 7 payment methods, mirrored from the API. Order = display order.
// `key` is the internal field name (DB + API contract — never change).
// `label` is the user-facing label, used everywhere in the UI.
const METHODS = [
  { key: 'techPaidCash',          label: 'Cash',         color: '#a5b4fc' },
  { key: 'totalPaidCard',         label: 'Card',         color: '#22d3ee' },
  { key: 'totalPaidCompanyCheck', label: 'Check',        color: '#34d399' },
  { key: 'totalPaidFinance',      label: 'Finance',      color: '#c4b5fd' },
  { key: 'totalPaidCompanyCash',  label: 'Company Cash', color: '#fbbf24' },
  { key: 'lmCash',                label: 'LM Cash',      color: '#f87171' },
  { key: 'lmCheck',               label: 'LM Check',     color: '#fb923c' },
] as const;
type MethodKey = typeof METHODS[number]['key'];
const METHOD_KEYS: MethodKey[] = METHODS.map((m) => m.key);
const METHOD_LABELS: string[] = METHODS.map((m) => m.label);
const METHOD_LABEL = (k: MethodKey) => METHODS.find((m) => m.key === k)?.label || k;
const METHOD_COLOR = (k: MethodKey) => METHODS.find((m) => m.key === k)?.color || '#94a3b8';
const KEY_FROM_LABEL = (label: string): MethodKey | undefined => METHODS.find((m) => m.label === label)?.key;

type GroupRow = {
  key: string;
  jobs: number;
  totalCollected: number;
  byMethod: Record<MethodKey, number>;
};

type ApiResponse = {
  summary: { totalCollected: number; totalJobs: number; avgJobValue: number; methodsUsed: number };
  byMethod: Array<{ key: MethodKey; label: string; total: number; jobs: number; pct: number }>;
  byTech: GroupRow[];
  byLocation: GroupRow[];
  byProvider: GroupRow[];
  byDate: GroupRow[];
  jobs: Array<{
    id: string; date: string; address: string; tech: string; location: string;
    provider: string; status: string; totalCollected: number; methodsUsed: string[];
  } & Record<MethodKey, number>>;
  meta: { startDate: string; endDate: string; jobsScanned: number };
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const defaultEnd = fmtDate(new Date());
const defaultStart = fmtDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));

export default function PaymentMethodReportPage() {
  const { narrowTechs, narrowLocations, narrowProviders } = useFilterRelationships();
  const { user } = useAuth();

  // Filter state
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [techs, setTechs] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>(['Closed']); // default: Closed only
  const [methodFilter, setMethodFilter] = useState<MethodKey[]>([]);

  // Applied state (triggers fetch)
  const [appliedStart, setAppliedStart] = useState(defaultStart);
  const [appliedEnd, setAppliedEnd] = useState(defaultEnd);
  const [appliedTechs, setAppliedTechs] = useState<string[]>([]);
  const [appliedLocations, setAppliedLocations] = useState<string[]>([]);
  const [appliedProviders, setAppliedProviders] = useState<string[]>([]);
  const [appliedStatuses, setAppliedStatuses] = useState<string[]>(['Closed']);
  const [appliedMethods, setAppliedMethods] = useState<MethodKey[]>([]);
  const [filtersDirty, setFiltersDirty] = useState(false);

  // Lookup options
  const [techOptions, setTechOptions] = useState<string[]>([]);
  const [locationOptions, setLocationOptions] = useState<string[]>([]);
  const [providerOptions, setProviderOptions] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);

  // Data
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<string | null>(null);

  // Drill-down state (display-only — never refetches)
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [byLocationOpen, setByLocationOpen] = useState(false);
  const [byProviderOpen, setByProviderOpen] = useState(false);
  const [techJobsOpen, setTechJobsOpen] = useState(true);
  const [standaloneJobsOpen, setStandaloneJobsOpen] = useState(true);

  // Auth gate — admin + location-manager. Per design, location-manager scoping
  // is deferred (matches existing read-access on /stats and /).
  if (!user || (user.type !== 'admin' && user.type !== 'location-manager')) {
    return (
      <div className="flex h-[60vh] items-center justify-center px-6">
        <EmptyState
          size="lg"
          icon={
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="8" stroke="#f87171" strokeWidth="1.5" />
              <line x1="10" y1="6" x2="10" y2="10.5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="10" cy="13" r="0.75" fill="#f87171" />
            </svg>
          }
          title="Access Denied"
          message="Admin or Location Manager access required to view this report."
        />
      </div>
    );
  }

  // Lookups: load once
  useEffect(() => {
    const fetchList = async (url: string): Promise<any[]> => {
      try {
        const res = await fetch(`${url}?page=1&pageSize=500`);
        if (!res.ok) return [];
        const json = await res.json();
        if (Array.isArray(json?.rows)) return json.rows;
        if (Array.isArray(json)) return json;
        return [];
      } catch {
        return [];
      }
    };
    (async () => {
      const [t, l, p, s] = await Promise.all([
        fetchList('/api/techs'),
        fetchList('/api/locations'),
        fetchList('/api/providers'),
        fetchList('/api/job-statuses'),
      ]);
      setTechOptions(t.map((x: any) => x._id ?? x).filter(Boolean));
      setLocationOptions(l.map((x: any) => x._id ?? x).filter(Boolean));
      setProviderOptions(p.map((x: any) => x._id ?? x).filter(Boolean));
      setStatusOptions(s.map((x: any) => x._id ?? x).filter(Boolean));
    })();
  }, []);

  // Fetch when applied state changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (appliedStart) params.set('startDate', appliedStart);
    if (appliedEnd) params.set('endDate', appliedEnd);
    appliedTechs.forEach((t) => params.append('tech', t));
    appliedLocations.forEach((l) => params.append('location', l));
    appliedProviders.forEach((p) => params.append('provider', p));
    appliedStatuses.forEach((s) => params.append('status', s));
    appliedMethods.forEach((m) => params.append('method', m));
    const key = params.toString();
    if (lastFetchRef.current === key) return;
    lastFetchRef.current = key;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/payment-method-report?${key}`);
        if (!res.ok) throw new Error('Failed to load');
        const json = (await res.json()) as ApiResponse;
        setData(json);
        setFiltersDirty(false);
      } catch (err) {
        console.error('Payment method report load error', err);
        setError('Failed to load payment method report');
      } finally {
        setLoading(false);
      }
    })();
  }, [appliedStart, appliedEnd, appliedTechs, appliedLocations, appliedProviders, appliedStatuses, appliedMethods]);

  const apply = () => {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setAppliedTechs(techs);
    setAppliedLocations(locations);
    setAppliedProviders(providers);
    setAppliedStatuses(statuses);
    setAppliedMethods(methodFilter);
    lastFetchRef.current = null;
    setFiltersDirty(false);
  };

  const summary = data?.summary;

  // Auto-clear selected tech if it disappears from current data
  useEffect(() => {
    if (selectedTech && data && !data.byTech.some((t) => t.key === selectedTech)) {
      setSelectedTech(null);
    }
  }, [data, selectedTech]);

  // In-memory derivations for drill-down — no refetch
  const techDetails = useMemo(() => {
    if (!selectedTech || !data) return null;
    const techRow = data.byTech.find((t) => t.key === selectedTech);
    const techJobs = data.jobs.filter((j) => j.tech === selectedTech);
    return { tech: techRow, jobs: techJobs };
  }, [selectedTech, data]);

  const hasMethodFilter = appliedMethods.length > 0;
  const showStandaloneJobs = !selectedTech && hasMethodFilter;

  // Pie chart data (only methods with non-zero totals).
  // Use local METHOD_LABEL — the API's `m.label` is ignored on the client
  // so all UI surfaces use the friendly user-facing labels.
  const piePayload = useMemo(() => {
    if (!data) return [];
    return data.byMethod
      .filter((m) => m.total > 0)
      .map((m) => ({ name: METHOD_LABEL(m.key), value: m.total, color: METHOD_COLOR(m.key), pct: m.pct, jobs: m.jobs }));
  }, [data]);

  // Stacked bar data: each entry = { date: '2026-05-01', techPaidCash: 100, totalPaidCard: 200, ... }
  const barData = useMemo(() => {
    if (!data) return [];
    return data.byDate.map((d) => {
      const row: any = { date: d.key };
      for (const k of METHOD_KEYS) row[k] = d.byMethod[k] || 0;
      return row;
    });
  }, [data]);

  return (
    <main className="balance-page">
      {loading && data && <div className="top-progress" />}
      <div className="content">

        {/* Header */}
        <header className="bp-header animate-fade-up">
          <div className="bp-header-left">
            <p className="bp-kicker">Finance · Reports</p>
            <h1 className="bp-title">Payment Method Report</h1>
            <div className="bp-meta">
              <span className="bp-meta-chip">
                <span className="bp-meta-chip-label">Range</span>
                <strong>{appliedStart} → {appliedEnd}</strong>
              </span>
              {data?.meta && (
                <span className="bp-meta-chip">
                  <span className="bp-meta-chip-label">Jobs scanned</span>
                  <strong>{data.meta.jobsScanned}</strong>
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Filters */}
        <FiltersPanel
          direction="horizontal"
          loading={loading}
          filtersDirty={filtersDirty}
          onApply={apply}
          error={error}
        >
          <FilterField label="Dates">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={(s, e) => { setStartDate(s); setEndDate(e); setFiltersDirty(true); }}
            />
          </FilterField>
          <FilterField label="Tech">
            <MultiSelect
              options={narrowTechs(techOptions, locations)}
              selected={techs}
              onChange={(v) => { setTechs(v); setFiltersDirty(true); }}
              placeholder="All techs"
              allLabel="All techs"
            />
          </FilterField>
          <FilterField label="Location">
            <MultiSelect
              options={narrowLocations(locationOptions, techs, providers)}
              selected={locations}
              onChange={(v) => { setLocations(v); setFiltersDirty(true); }}
              placeholder="All locations"
              allLabel="All locations"
            />
          </FilterField>
          <FilterField label="Provider">
            <MultiSelect
              options={narrowProviders(providerOptions, locations)}
              selected={providers}
              onChange={(v) => { setProviders(v); setFiltersDirty(true); }}
              placeholder="All providers"
              allLabel="All providers"
            />
          </FilterField>
          <FilterField label="Status">
            <MultiSelect
              options={statusOptions}
              selected={statuses}
              onChange={(v) => { setStatuses(v); setFiltersDirty(true); }}
              placeholder="All statuses"
              allLabel="All statuses"
            />
          </FilterField>
          <FilterField label="Methods">
            <MultiSelect
              options={METHOD_LABELS}
              selected={methodFilter.map((k) => METHOD_LABEL(k))}
              onChange={(labels) => {
                const keys = labels
                  .map((l) => KEY_FROM_LABEL(l))
                  .filter((k): k is MethodKey => Boolean(k));
                setMethodFilter(keys);
                setFiltersDirty(true);
              }}
              placeholder="All methods"
              allLabel="All methods"
            />
          </FilterField>
        </FiltersPanel>

        {/* KPI strip */}
        <section className="bp-kpi-strip stagger">
          <PmrKpi label="Total Collected" value={formatCurrency(summary?.totalCollected || 0)} icon={<FiCreditCard size={14} />} accent="indigo" />
          <PmrKpi label="Total Jobs"      value={String(summary?.totalJobs ?? 0)}                icon={<FiBriefcase size={14} />}  accent="cyan" />
          <PmrKpi label="Avg Job Value"   value={formatCurrency(summary?.avgJobValue || 0)}     icon={<FiTrendingUp size={14} />} accent="emerald" />
          <PmrKpi label="Methods Used"    value={`${summary?.methodsUsed ?? 0} / ${METHODS.length}`} icon={<FiLayers size={14} />}    accent="violet" />
        </section>

        {/* By Method — pie + table */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '60ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">Breakdown</p>
              <h3>By Payment Method</h3>
            </div>
            <span className="bp-pill">{piePayload.length} methods used</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 16, padding: '0 16px 16px', alignItems: 'start' }}>
            <div style={{ minHeight: 240 }}>
              {piePayload.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={piePayload} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={1}>
                      {piePayload.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <RTooltip content={<PiePmrTooltip />} isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState size="sm" title="No payments collected" />
              )}
            </div>
            <div className="balance-table" style={{ position: 'relative' }}>
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Total</th>
                    <th>Jobs</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.byMethod ?? []).map((m) => (
                    <tr key={m.key}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 999, background: METHOD_COLOR(m.key) }} />
                          {METHOD_LABEL(m.key)}
                        </span>
                      </td>
                      <td style={{ fontWeight: m.total > 0 ? 600 : undefined }}>{formatCurrency(m.total)}</td>
                      <td>{m.jobs}</td>
                      <td>{m.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* By Date — stacked bar */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">Trend</p>
              <h3>Daily Collection (stacked by method)</h3>
            </div>
            <span className="bp-pill">{barData.length} days</span>
          </div>
          <div style={{ padding: '0 16px 16px', minHeight: 280 }}>
            {barData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} margin={{ top: 6, right: 12, bottom: 6, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <RTooltip content={<StackPmrTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                  {METHODS.map((m) => (
                    <Bar key={m.key} dataKey={m.key} stackId="a" fill={m.color} name={m.label} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState size="sm" title="No date data" />
            )}
          </div>
        </div>

        {/* Per Technician — compact clickable list */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '150ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">Drill-down</p>
              <h3>Per Technician</h3>
            </div>
            <span className="bp-pill">{data?.byTech.length ?? 0} techs</span>
          </div>
          <div className="balance-table" style={{ position: 'relative' }}>
            {loading && !data && <LoadingOverlay message="Loading payment method report..." />}
            <table>
              <thead>
                <tr>
                  <th>Tech</th>
                  <th>Total</th>
                  <th>Jobs</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.byTech ?? []).map((r) => {
                  const isSelected = selectedTech === r.key;
                  return (
                    <tr
                      key={r.key}
                      className={`pmr-tech-row ${isSelected ? 'pmr-tech-row--selected' : ''}`}
                      onClick={() => setSelectedTech(isSelected ? null : r.key)}
                      role="button"
                      aria-pressed={isSelected}
                    >
                      <td>
                        {isSelected && <span className="pmr-row-arrow">▶</span>}
                        {r.key}
                      </td>
                      <td style={{ fontWeight: 600 }}>{formatCurrency(r.totalCollected)}</td>
                      <td>{r.jobs}</td>
                      <td className="pmr-row-action">{isSelected ? 'Selected' : 'Select →'}</td>
                    </tr>
                  );
                })}
                {!data?.byTech.length && !loading && (
                  <tr className="empty-row">
                    <td colSpan={4}><EmptyState size="sm" title="No data" /></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tech Details Panel — only when a tech is selected */}
        {techDetails && (
          <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="panel-header">
              <div>
                <p className="bp-section-kicker">Details</p>
                <h3>{selectedTech}</h3>
              </div>
              <button type="button" onClick={() => setSelectedTech(null)} className="pmr-clear-btn">
                ✕ Clear selection
              </button>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              <div className="pmr-details-summary">
                {techDetails.jobs.length} {techDetails.jobs.length === 1 ? 'job' : 'jobs'} · {formatCurrency(techDetails.tech?.totalCollected || 0)} collected
              </div>

              <h4 className="pmr-subhead">Payment breakdown</h4>
              <table className="pmr-mini-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {METHODS.map((m) => {
                    const total = techDetails.tech?.byMethod[m.key] || 0;
                    const tot = techDetails.tech?.totalCollected ?? 0;
                    const pct = tot > 0 ? (total / tot) * 100 : 0;
                    return (
                      <tr key={m.key}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 999, background: m.color }} />
                            {m.label}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: total > 0 ? 600 : undefined }}>{formatCurrency(total)}</td>
                        <td style={{ textAlign: 'right' }}>{pct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Jobs accordion (expanded by default per spec) */}
              <div className="pmr-accordion" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="pmr-accordion-header"
                  onClick={() => setTechJobsOpen((o) => !o)}
                  aria-expanded={techJobsOpen}
                >
                  <span className="pmr-accordion-title">
                    <span className="pmr-chevron">{techJobsOpen ? '▾' : '▸'}</span>
                    Jobs · {selectedTech}
                  </span>
                  <span className="bp-pill">{techDetails.jobs.length} jobs</span>
                </button>
                {techJobsOpen && (
                  <div className="balance-table pmr-accordion-body">
                    <JobsTable jobs={techDetails.jobs} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* By Location — collapsible accordion */}
        <AccordionPanel
          kicker="Per location"
          title="By Location"
          count={data?.byLocation.length ?? 0}
          open={byLocationOpen}
          onToggle={() => setByLocationOpen((o) => !o)}
        >
          <BreakdownTable rows={data?.byLocation ?? []} keyHeader="Location" />
        </AccordionPanel>

        {/* By Provider — collapsible accordion */}
        <AccordionPanel
          kicker="Per provider"
          title="By Provider"
          count={data?.byProvider.length ?? 0}
          open={byProviderOpen}
          onToggle={() => setByProviderOpen((o) => !o)}
        >
          <BreakdownTable rows={data?.byProvider ?? []} keyHeader="Provider" />
        </AccordionPanel>

        {/* Standalone Jobs — only when method filter is active and no tech selected */}
        {showStandaloneJobs && (
          <div className="pmr-accordion-wrap animate-fade-up">
            <div className="pmr-accordion">
              <button
                type="button"
                className="pmr-accordion-header"
                onClick={() => setStandaloneJobsOpen((o) => !o)}
                aria-expanded={standaloneJobsOpen}
              >
                <span className="pmr-accordion-title">
                  <span className="pmr-chevron">{standaloneJobsOpen ? '▾' : '▸'}</span>
                  Jobs (filtered by method)
                </span>
                <span className="bp-pill">{data?.jobs.length ?? 0} jobs</span>
              </button>
              {standaloneJobsOpen && (
                <div className="balance-table pmr-accordion-body">
                  <JobsTable jobs={data?.jobs ?? []} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

type Accent = 'indigo' | 'cyan' | 'emerald' | 'violet' | 'red' | 'amber';

const accents: Record<Accent, { bg: string; border: string; text: string; glow: string }> = {
  indigo:  { bg: 'rgba(99,102,241,0.10)',  border: 'rgba(99,102,241,0.25)',  text: '#a5b4fc', glow: 'rgba(99,102,241,0.12)' },
  cyan:    { bg: 'rgba(6,182,212,0.10)',   border: 'rgba(6,182,212,0.25)',   text: '#22d3ee', glow: 'rgba(6,182,212,0.10)'  },
  emerald: { bg: 'rgba(16,185,129,0.10)',  border: 'rgba(16,185,129,0.25)',  text: '#34d399', glow: 'rgba(16,185,129,0.10)' },
  violet:  { bg: 'rgba(139,92,246,0.10)',  border: 'rgba(139,92,246,0.25)',  text: '#c4b5fd', glow: 'rgba(139,92,246,0.10)' },
  red:     { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.25)',   text: '#f87171', glow: 'rgba(239,68,68,0.10)'  },
  amber:   { bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)',  text: '#fbbf24', glow: 'rgba(245,158,11,0.10)' },
};

function PmrKpi({ label, value, icon, accent }: { label: string; value: string; icon: ReactNode; accent: Accent }) {
  const a = accents[accent];
  return (
    <div className="bp-kpi hover-lift">
      <div className="bp-kpi-glow" style={{ background: `radial-gradient(circle at top right, ${a.glow}, transparent 70%)` }} />
      <div className="bp-kpi-row">
        <div className="bp-kpi-icon" style={{ background: a.bg, color: a.text, border: `1px solid ${a.border}` }}>{icon}</div>
        <span className="bp-kpi-label">{label}</span>
      </div>
      <div className="bp-kpi-value">{value}</div>
    </div>
  );
}

function AccordionPanel({
  kicker, title, count, open, onToggle, children,
}: {
  kicker: string; title: string; count: number;
  open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '60ms' }}>
      <button type="button" className="panel-header pmr-panel-toggle" onClick={onToggle} aria-expanded={open}>
        <div>
          <p className="bp-section-kicker">{kicker}</p>
          <h3>{title}</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="bp-pill">{count} rows</span>
          <span className="pmr-chevron-lg" aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
        </div>
      </button>
      {open && (
        <div className="balance-table" style={{ position: 'relative' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ rows, keyHeader }: { rows: GroupRow[]; keyHeader: string }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{keyHeader}</th>
          <th>Jobs</th>
          {METHODS.map((m) => <th key={m.key}>{m.label}</th>)}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td>{r.jobs}</td>
            {METHODS.map((m) => <td key={m.key}>{formatCurrency(r.byMethod[m.key])}</td>)}
            <td style={{ fontWeight: 600 }}>{formatCurrency(r.totalCollected)}</td>
          </tr>
        ))}
        {!rows.length && (
          <tr className="empty-row">
            <td colSpan={2 + METHODS.length + 1}>
              <EmptyState size="sm" title="No data" />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function JobsTable({ jobs }: { jobs: ApiResponse['jobs'] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Address</th>
          <th>Tech</th>
          <th>Location</th>
          <th>Provider</th>
          <th>Status</th>
          {METHODS.map((m) => <th key={m.key}>{m.label}</th>)}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id}>
            <td>{formatDisplayDate(j.date)}</td>
            <td className="truncate" title={j.address}>{j.address || '-'}</td>
            <td>{j.tech || '-'}</td>
            <td>{j.location || '-'}</td>
            <td>{j.provider || '-'}</td>
            <td>{j.status || '-'}</td>
            {METHODS.map((m) => <td key={m.key}>{formatCurrency(j[m.key])}</td>)}
            <td style={{ fontWeight: 600 }}>{formatCurrency(j.totalCollected)}</td>
          </tr>
        ))}
        {!jobs.length && (
          <tr className="empty-row">
            <td colSpan={6 + METHODS.length + 1}>
              <EmptyState size="sm" title="No jobs in current selection" />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

type PiePayload = { name: string; value: number; color: string; pct: number; jobs: number };

function PiePmrTooltip(props: TooltipProps<number, string> & { payload?: Array<{ payload: PiePayload }> }) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as PiePayload;
  return (
    <div className="pie-tooltip">
      <div className="pie-tooltip__title">{d.name}</div>
      <div className="pie-tooltip__row"><span>Total</span><strong>{formatCurrency(d.value)}</strong></div>
      <div className="pie-tooltip__row"><span>Jobs</span><strong>{d.jobs}</strong></div>
      <div className="pie-tooltip__row"><span>Share</span><strong>{d.pct.toFixed(1)}%</strong></div>
    </div>
  );
}

type StackPmrTooltipProps = TooltipProps<number, string> & {
  payload?: Array<{ value?: number; name?: string; color?: string }>;
  label?: string | number;
};
function StackPmrTooltip(props: StackPmrTooltipProps) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="pie-tooltip" style={{ minWidth: 180 }}>
      <div className="pie-tooltip__title">{label}</div>
      {payload.map((p, i) => (
        Number(p.value) > 0 ? (
          <div key={i} className="pie-tooltip__row">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color }} />
              {p.name}
            </span>
            <strong>{formatCurrency(Number(p.value))}</strong>
          </div>
        ) : null
      ))}
      <div className="pie-tooltip__row" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 4, paddingTop: 4 }}>
        <span>Total</span><strong>{formatCurrency(total)}</strong>
      </div>
    </div>
  );
}
