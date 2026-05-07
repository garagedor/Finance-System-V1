'use client';

import { useEffect, useRef, useState } from 'react';
import { FiBriefcase, FiDollarSign, FiAlertCircle } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import DateRangePicker from '@/components/DateRangePicker';
import FiltersPanel, { FilterField } from '@/components/FiltersPanel';
import EmptyState from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { formatCurrency } from '../utils/jobUtils';
import '../balance-report/styles.css';

type TechBalanceRow = { tech: string; jobs: number; balance: number };
type TechLmRow = { tech: string; jobsWithLmParts: number; techOwesLm: number };
type LmCompanyRow = {
  location: string;
  jobsWithLmRevenue: number;
  lmCashTotal: number;
  lmCheckTotal: number;
  lmOwesCompany: number;
};

type FinanceResponse = {
  techBalances: TechBalanceRow[];
  techLmSettlement: TechLmRow[];
  lmCompanySettlement: LmCompanyRow[];
  totals: {
    grandCompanyTechBalance: number;
    grandTechOwesLm: number;
    grandLmOwesCompany: number;
  };
  meta: { startDate: string; endDate: string; location: string; jobsScanned: number };
};

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const defaultEnd = fmtDate(new Date());
const defaultStart = fmtDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));

export default function FinancePage() {
  const { user } = useAuth();

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [appliedStart, setAppliedStart] = useState(defaultStart);
  const [appliedEnd, setAppliedEnd] = useState(defaultEnd);
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<string | null>(null);

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

  useEffect(() => {
    const search = new URLSearchParams();
    search.set('startDate', appliedStart);
    search.set('endDate', appliedEnd);
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
  }, [appliedStart, appliedEnd]);

  const apply = () => {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    lastFetchRef.current = null;
    setFiltersDirty(false);
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
        </FiltersPanel>

        {/* KPI Strip — 3 independent settlement totals, never combined */}
        <section className="bp-kpi-strip stagger">
          <FinanceKpi
            label="Company ↔ Tech (closed)"
            value={formatCurrency(totals?.grandCompanyTechBalance || 0)}
            icon={<FiBriefcase size={14} />}
            accent="indigo"
          />
          <FinanceKpi
            label="Tech ↔ LM (parts)"
            value={formatCurrency(totals?.grandTechOwesLm || 0)}
            icon={<FiAlertCircle size={14} />}
            accent="amber"
          />
          <FinanceKpi
            label="LM ↔ Company (cash + check)"
            value={formatCurrency(totals?.grandLmOwesCompany || 0)}
            icon={<FiDollarSign size={14} />}
            accent="cyan"
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

        {/* Panel 2 — Tech ↔ LM (View 2: lmParts, all jobs with LM parts) */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">View 2 · Tech ↔ LM</p>
              <h3>Tech Owes LM (parts supplied by Location Manager)</h3>
            </div>
            <span className="bp-pill">{data?.techLmSettlement.length ?? 0} techs</span>
          </div>
          <div className="balance-table" style={{ position: 'relative' }}>
            <table>
              <thead>
                <tr>
                  <th>Tech</th>
                  <th>Jobs w/ LM Parts</th>
                  <th>Tech Owes LM</th>
                </tr>
              </thead>
              <tbody>
                {(data?.techLmSettlement ?? []).map((r) => (
                  <tr key={r.tech}>
                    <td>{r.tech}</td>
                    <td>{r.jobsWithLmParts}</td>
                    <td style={{ color: r.techOwesLm > 0 ? '#fbbf24' : undefined, fontWeight: r.techOwesLm > 0 ? 600 : undefined }}>
                      {formatCurrency(r.techOwesLm)}
                    </td>
                  </tr>
                ))}
                {!data?.techLmSettlement.length && !loading && (
                  <tr className="empty-row">
                    <td colSpan={3}>
                      <EmptyState size="md" title="No LM parts activity" message="No jobs in this range have LM Parts." />
                    </td>
                  </tr>
                )}
              </tbody>
              {!!data?.techLmSettlement.length && (
                <tfoot>
                  <tr className="totals-row">
                    <td className="totals-cell">Totals</td>
                    <td>{data.techLmSettlement.reduce((s, r) => s + r.jobsWithLmParts, 0)}</td>
                    <td style={{ fontWeight: 700 }}>{formatCurrency(totals?.grandTechOwesLm || 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Panel 3 — LM ↔ Company (View 3: lmCash + lmCheck, all jobs with LM revenue) */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '180ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">View 3 · LM ↔ Company</p>
              <h3>LM Owes Company (cash + check collected on company's behalf)</h3>
            </div>
            <span className="bp-pill">{data?.lmCompanySettlement.length ?? 0} locations</span>
          </div>
          <div className="balance-table" style={{ position: 'relative' }}>
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Jobs w/ LM Revenue</th>
                  <th>LM Cash</th>
                  <th>LM Check</th>
                  <th>LM Owes Company</th>
                </tr>
              </thead>
              <tbody>
                {(data?.lmCompanySettlement ?? []).map((r) => (
                  <tr key={r.location}>
                    <td>{r.location}</td>
                    <td>{r.jobsWithLmRevenue}</td>
                    <td>{formatCurrency(r.lmCashTotal)}</td>
                    <td>{formatCurrency(r.lmCheckTotal)}</td>
                    <td style={{ color: r.lmOwesCompany > 0 ? '#22d3ee' : undefined, fontWeight: r.lmOwesCompany > 0 ? 600 : undefined }}>
                      {formatCurrency(r.lmOwesCompany)}
                    </td>
                  </tr>
                ))}
                {!data?.lmCompanySettlement.length && !loading && (
                  <tr className="empty-row">
                    <td colSpan={5}>
                      <EmptyState size="md" title="No LM revenue activity" message="No jobs in this range have LM Cash or LM Check." />
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
