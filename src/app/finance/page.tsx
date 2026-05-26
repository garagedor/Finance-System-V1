'use client';

import { useEffect, useRef, useState } from 'react';
import { FiBriefcase, FiDollarSign, FiFileText, FiPackage } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import DateRangePicker from '@/components/DateRangePicker';
import FiltersPanel, { FilterField } from '@/components/FiltersPanel';
import MultiSelect from '@/components/MultiSelect';
import { useFilterRelationships } from '@/hooks/useFilterRelationships';
import EmptyState from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { formatCurrency } from '../utils/jobUtils';
import type { Technician, Location } from '@/types/job';
import '../balance-report/styles.css';

type TechBalanceRow = { tech: string; jobs: number; balance: number };
type LmCompanyRow = {
  location: string;
  jobsTouched: number;
  lmCashTotal: number;
  lmCheckTotal: number;
  lmOwesCompany: number;
  fortyPctPayout: number;
  lmPartsTotal: number;
  companyOwesLm: number;
  netLmOwesCompany: number;
};

type FinanceResponse = {
  techBalances: TechBalanceRow[];
  lmCompanySettlement: LmCompanyRow[];
  totals: {
    grandCompanyTechBalance: number;
    grandTechCommission: number;
    grandLmOwesCompany: number;
    grandCompanyOwesLm: number;
    grandNetLmOwesCompany: number;
    grandFortyPctPayout: number;
  };
  meta: { startDate: string; endDate: string; techs?: string[]; locations?: string[]; jobsScanned: number };
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const defaultEnd = fmtDate(new Date());
const defaultStart = fmtDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));

export default function FinancePage() {
  const { narrowTechs, narrowLocations } = useFilterRelationships();
  const { user } = useAuth();

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [techs, setTechs] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [appliedStart, setAppliedStart] = useState(defaultStart);
  const [appliedEnd, setAppliedEnd] = useState(defaultEnd);
  const [appliedTechs, setAppliedTechs] = useState<string[]>([]);
  const [appliedLocations, setAppliedLocations] = useState<string[]>([]);
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookups, setLookups] = useState<{ techs: Technician[]; locations: Location[] }>({ techs: [], locations: [] });
  const lastFetchRef = useRef<string | null>(null);
  const lookupsFetchedRef = useRef(false);

  if (!user || user.type !== 'admin') {
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
          message="Admin privileges required to view the Finance Dashboard."
        />
      </div>
    );
  }

  // Restore filters from sessionStorage on mount.
  useEffect(() => {
    const saved = sessionStorage.getItem('finance-filters');
    if (!saved) return;
    try {
      const { start, end, techs: t, locations: l } = JSON.parse(saved);
      if (start) { setStartDate(start); setAppliedStart(start); }
      if (end)   { setEndDate(end);     setAppliedEnd(end); }
      if (Array.isArray(t)) { setTechs(t); setAppliedTechs(t); }
      if (Array.isArray(l)) { setLocations(l); setAppliedLocations(l); }
    } catch (e) {
      console.error('Failed to parse saved finance filters', e);
    }
  }, []);

  // Fetch tech & location lookups for the multi-selects.
  useEffect(() => {
    if (lookupsFetchedRef.current) return;
    lookupsFetchedRef.current = true;
    const fetchList = async (url: string) => {
      try {
        const res = await fetch(`${url}?page=1&pageSize=500`);
        if (!res.ok) return [];
        const j = await res.json();
        if (Array.isArray(j?.rows)) return j.rows;
        if (Array.isArray(j)) return j;
        return [];
      } catch { return []; }
    };
    Promise.all([fetchList('/api/techs'), fetchList('/api/locations')])
      .then(([techs, locations]) => setLookups({ techs, locations }));
  }, []);

  useEffect(() => {
    const search = new URLSearchParams();
    search.set('startDate', appliedStart);
    search.set('endDate', appliedEnd);
    appliedTechs.forEach((t) => search.append('tech', t));
    appliedLocations.forEach((l) => search.append('location', l));
    const key = search.toString();
    if (lastFetchRef.current === key) return;
    lastFetchRef.current = key;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/finance?${key}`);
        if (!res.ok) throw new Error('Failed to load finance dashboard');
        const json = (await res.json()) as FinanceResponse;
        setData(json);
        setFiltersDirty(false);
      } catch (err) {
        console.error('Finance dashboard load error', err);
        setError('Failed to load finance dashboard');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [appliedStart, appliedEnd, appliedTechs, appliedLocations]);

  const apply = () => {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setAppliedTechs(techs);
    setAppliedLocations(locations);
    lastFetchRef.current = null;
    setFiltersDirty(false);
    sessionStorage.setItem('finance-filters', JSON.stringify({
      start: startDate, end: endDate, techs, locations,
    }));
  };

  const totals = data?.totals;

  return (
    <main className="balance-page">
      {loading && data && <div className="top-progress" />}
      <div className="content">
        <header className="bp-header animate-fade-up">
          <div className="bp-header-left">
            <p className="bp-kicker">Finance</p>
            <h1 className="bp-title">Finance Dashboard</h1>
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
              onChange={(s, e) => {
                setStartDate(s);
                setEndDate(e);
                setFiltersDirty(true);
              }}
            />
          </FilterField>
          <FilterField label="Tech">
            <MultiSelect
              options={narrowTechs(lookups.techs.map((t) => t._id), locations)}
              selected={techs}
              onChange={(v) => { setTechs(v); setFiltersDirty(true); }}
              placeholder="All techs"
              allLabel="All techs"
            />
          </FilterField>
          <FilterField label="Location">
            <MultiSelect
              options={narrowLocations(lookups.locations.map((l) => l._id), techs, [])}
              selected={locations}
              onChange={(v) => { setLocations(v); setFiltersDirty(true); }}
              placeholder="All locations"
              allLabel="All locations"
            />
          </FilterField>
        </FiltersPanel>

        {/* KPI Strip — settlement totals + raw LM activity breakdown */}
        <section className="bp-kpi-strip stagger">
          <FinanceKpi
            label="Company ↔ Tech (closed)"
            value={formatCurrency(totals?.grandCompanyTechBalance || 0)}
            icon={<FiBriefcase size={14} />}
            accent="indigo"
          />
          <FinanceKpi
            label="LM ↔ Company (net)"
            value={formatCurrency(totals?.grandNetLmOwesCompany || 0)}
            icon={<FiDollarSign size={14} />}
            accent="cyan"
          />
          <FinanceKpi
            label="LM Cash (collected)"
            value={formatCurrency((data?.lmCompanySettlement || []).reduce((s, r) => s + r.lmCashTotal, 0))}
            icon={<FiDollarSign size={14} />}
            accent="emerald"
          />
          <FinanceKpi
            label="LM Check (collected)"
            value={formatCurrency((data?.lmCompanySettlement || []).reduce((s, r) => s + r.lmCheckTotal, 0))}
            icon={<FiFileText size={14} />}
            accent="amber"
          />
          <FinanceKpi
            label="LM Parts"
            value={formatCurrency((data?.lmCompanySettlement || []).reduce((s, r) => s + r.lmPartsTotal, 0))}
            icon={<FiPackage size={14} />}
            accent="violet"
          />
          <FinanceKpi
            label="LM Commission"
            value={formatCurrency(
              (totals?.grandFortyPctPayout || 0) - (totals?.grandTechCommission || 0)
            )}
            icon={<FiBriefcase size={14} />}
            accent="red"
          />
        </section>

        {/* Panel 1 — Company ↔ Tech (View 1: original balance, closed jobs only) */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '60ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">View 1 · Company ↔ Tech</p>
              <h3>Tech Balances (closed jobs)</h3>
            </div>
            <span className="bp-pill">{data?.techBalances.length ?? 0} techs</span>
          </div>
          <div className="balance-table" style={{ position: 'relative' }}>
            {loading && !data && <LoadingOverlay message="Loading finance dashboard..." />}
            <table>
              <thead>
                <tr>
                  <th>Tech</th>
                  <th>Closed Jobs</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(data?.techBalances ?? []).map((r) => (
                  <tr key={r.tech}>
                    <td>{r.tech}</td>
                    <td>{r.jobs}</td>
                    <td style={{ color: r.balance < 0 ? '#f87171' : r.balance > 0 ? '#34d399' : undefined, fontWeight: r.balance !== 0 ? 600 : undefined }}>
                      {formatCurrency(r.balance)}
                    </td>
                  </tr>
                ))}
                {!data?.techBalances.length && !loading && (
                  <tr className="empty-row">
                    <td colSpan={3}>
                      <EmptyState size="md" title="No closed-job balances" message="Try a different date range." />
                    </td>
                  </tr>
                )}
              </tbody>
              {!!data?.techBalances.length && (
                <tfoot>
                  <tr className="totals-row">
                    <td className="totals-cell">Totals</td>
                    <td>{data.techBalances.reduce((s, r) => s + r.jobs, 0)}</td>
                    <td style={{ fontWeight: 700 }}>{formatCurrency(totals?.grandCompanyTechBalance || 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Panel 2 — LM ↔ Company net settlement.
            LM owes Co.: lmCash + lmCheck (collected on company's behalf).
            Co.  owes LM: 40% (locationPct) of profit on closed jobs + lmParts.
            Net = LM owes − Co. owes (positive = LM still owes; negative = Co. owes LM). */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">View 2 · LM ↔ Company (net)</p>
              <h3>LM Settlement</h3>
            </div>
            <span className="bp-pill">{data?.lmCompanySettlement.length ?? 0} locations</span>
          </div>
          <div className="balance-table" style={{ position: 'relative' }}>
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Jobs</th>
                  <th>LM Cash</th>
                  <th>LM Check</th>
                  <th>LM → Co.</th>
                  <th>40% Payout</th>
                  <th>LM Parts</th>
                  <th>Co. → LM</th>
                  <th>Net (LM owes Co.)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.lmCompanySettlement ?? []).map((r) => (
                  <tr key={r.location}>
                    <td>{r.location}</td>
                    <td>{r.jobsTouched}</td>
                    <td>{formatCurrency(r.lmCashTotal)}</td>
                    <td>{formatCurrency(r.lmCheckTotal)}</td>
                    <td style={{ color: r.lmOwesCompany > 0 ? '#22d3ee' : undefined }}>
                      {formatCurrency(r.lmOwesCompany)}
                    </td>
                    <td>{formatCurrency(r.fortyPctPayout)}</td>
                    <td>{formatCurrency(r.lmPartsTotal)}</td>
                    <td style={{ color: r.companyOwesLm > 0 ? '#a78bfa' : undefined }}>
                      {formatCurrency(r.companyOwesLm)}
                    </td>
                    <td style={{
                      color: r.netLmOwesCompany > 0 ? '#34d399' : r.netLmOwesCompany < 0 ? '#f87171' : undefined,
                      fontWeight: r.netLmOwesCompany !== 0 ? 700 : undefined,
                    }}>
                      {formatCurrency(r.netLmOwesCompany)}
                    </td>
                  </tr>
                ))}
                {!data?.lmCompanySettlement.length && !loading && (
                  <tr className="empty-row">
                    <td colSpan={9}>
                      <EmptyState size="md" title="No LM activity" message="No jobs in this range have LM cash, check, parts, or 40% payout." />
                    </td>
                  </tr>
                )}
              </tbody>
              {!!data?.lmCompanySettlement.length && (
                <tfoot>
                  <tr className="totals-row">
                    <td className="totals-cell" colSpan={2}>Totals</td>
                    <td>{formatCurrency(data.lmCompanySettlement.reduce((s, r) => s + r.lmCashTotal, 0))}</td>
                    <td>{formatCurrency(data.lmCompanySettlement.reduce((s, r) => s + r.lmCheckTotal, 0))}</td>
                    <td style={{ fontWeight: 700 }}>{formatCurrency(totals?.grandLmOwesCompany || 0)}</td>
                    <td>{formatCurrency(data.lmCompanySettlement.reduce((s, r) => s + r.fortyPctPayout, 0))}</td>
                    <td>{formatCurrency(data.lmCompanySettlement.reduce((s, r) => s + r.lmPartsTotal, 0))}</td>
                    <td style={{ fontWeight: 700 }}>{formatCurrency(totals?.grandCompanyOwesLm || 0)}</td>
                    <td style={{ fontWeight: 700 }}>{formatCurrency(totals?.grandNetLmOwesCompany || 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

type Accent = 'indigo' | 'cyan' | 'emerald' | 'violet' | 'red' | 'amber';

const accents: Record<Accent, { bg: string; border: string; text: string; glow: string }> = {
  indigo:  { bg: 'rgba(99,102,241,0.10)',  border: 'rgba(99,102,241,0.25)',  text: '#a5b4fc', glow: 'rgba(99,102,241,0.12)' },
  cyan:    { bg: 'rgba(6,182,212,0.10)',   border: 'rgba(6,182,212,0.25)',   text: '#22d3ee', glow: 'rgba(6,182,212,0.10)'  },
  emerald: { bg: 'rgba(16,185,129,0.10)',  border: 'rgba(16,185,129,0.25)',  text: '#34d399', glow: 'rgba(16,185,129,0.10)' },
  violet:  { bg: 'rgba(139,92,246,0.10)',  border: 'rgba(139,92,246,0.25)',  text: '#c4b5fd', glow: 'rgba(139,92,246,0.10)' },
  red:     { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.25)',   text: '#f87171', glow: 'rgba(239,68,68,0.10)'  },
  amber:   { bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)',  text: '#fbbf24', glow: 'rgba(245,158,11,0.10)' },
};

function FinanceKpi({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: Accent }) {
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
