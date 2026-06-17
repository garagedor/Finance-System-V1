'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FiCheck, FiX, FiAlertTriangle, FiArrowLeft, FiChevronRight, FiCheckCircle, FiHelpCircle, FiUsers, FiCalendar, FiEdit2 } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import EmptyState from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { formatCurrency, formatDisplayDate } from '../utils/jobUtils';
import '../balance-report/styles.css';

type ReportSummary = {
  id: string;
  techName: string;
  techMatched: boolean;
  areaName: string;
  areaMatched: boolean;
  weekStart: string;
  weekEnd: string;
  status: string;
  resubmitted?: boolean;
  submittedAt: string | null;
  supabaseJobCount: number;
  supabaseTotalSales: number;
  supabaseBalance?: number;
  supabaseCommission?: number;
  supabaseTips?: number;
  hasTechMapping?: boolean;
  hasAreaMapping?: boolean;
};

type FieldDiff = {
  field: string;
  label: string;
  supabase: number;
  crm: number;
  diff: number;
  exceedsTolerance: boolean;
};

type Pair = {
  status: 'match' | 'mismatch' | 'missing-in-crm' | 'missing-in-report';
  supabaseJob: any | null;
  crmJob: any | null;
  diffs: FieldDiff[];
  methodDiff?: { supabase: string | null; crm: string | null } | null;
  manualLink?: boolean;
};

type DetailResponse = {
  report: {
    id: string;
    techName: string;
    techMatched: boolean;
    areaName: string;
    areaMatched: boolean;
    weekStart: string;
    weekEnd: string;
    status: string;
    submittedAt: string | null;
    adminNote?: string;
    adminNoteUpdatedAt?: string | null;
    adminNoteUpdatedBy?: string | null;
  };
  summary: {
    matched: number;
    mismatched: number;
    missingInCrm: number;
    missingInReport: number;
    supabaseJobCount: number;
    crmJobCount: number;
  };
  totals: {
    supabase: any;
    crm: any;
    diffs: any;
  };
  pairs: Pair[];
};

type StatusFilter = 'Submitted' | 'Under Review' | 'Returned' | 'Approved' | 'All';
const STATUS_FILTERS: StatusFilter[] = ['Submitted', 'Under Review', 'Returned', 'Approved', 'All'];

export default function VerifyReportsPage() {
  const { user } = useAuth();
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Submitted');

  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  // When set, the list loads ALL statuses and the rendered rows are filtered
  // to this tech only — gives an at-a-glance week-by-week history per tech.
  const [techFilter, setTechFilter] = useState<string>('');

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  if (!user || user.type !== 'admin') {
    return (
      <div className="flex h-[60vh] items-center justify-center px-6">
        <EmptyState
          size="lg"
          icon={<svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="#f87171" strokeWidth="1.5" />
            <line x1="10" y1="6" x2="10" y2="10.5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="10" cy="13" r="0.75" fill="#f87171" />
          </svg>}
          title="Access Denied"
          message="Admin privileges required to verify weekly reports."
        />
      </div>
    );
  }

  // Load list — when a tech is being filtered, load ALL statuses regardless
  // of the visible status tab so the per-tech history is complete.
  useEffect(() => {
    if (view !== 'list') return;
    setListLoading(true);
    setListError(null);
    const effectiveStatus: StatusFilter = techFilter ? 'All' : statusFilter;
    const params = effectiveStatus === 'All'
      ? STATUS_FILTERS.filter((s) => s !== 'All').map((s) => `status=${encodeURIComponent(s)}`).join('&')
      : `status=${encodeURIComponent(effectiveStatus)}`;
    fetch(`/api/verify/weekly-reports?${params}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
        return j;
      })
      .then((j) => setReports(j.reports || []))
      .catch((e) => setListError(String(e.message || e)))
      .finally(() => setListLoading(false));
  }, [view, statusFilter, techFilter]);

  // Load detail
  useEffect(() => {
    if (view !== 'detail' || !selectedId) return;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    fetch(`/api/verify/weekly-reports/${selectedId}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
        return j;
      })
      .then((j) => setDetail(j))
      .catch((e) => setDetailError(String(e.message || e)))
      .finally(() => setDetailLoading(false));
  }, [view, selectedId, detailRefreshKey]);

  if (view === 'detail') {
    return (
      <DetailView
        loading={detailLoading}
        error={detailError}
        data={detail}
        onBack={() => { setView('list'); setSelectedId(null); }}
        onRefresh={() => setDetailRefreshKey((k) => k + 1)}
      />
    );
  }

  return (
    <ListView
      loading={listLoading}
      error={listError}
      reports={reports}
      onOpen={(id) => { setSelectedId(id); setView('detail'); }}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      techFilter={techFilter}
      setTechFilter={setTechFilter}
    />
  );
}

// ─── LIST VIEW ──────────────────────────────────────────────────────────────

function ListView({
  loading, error, reports, onOpen, statusFilter, setStatusFilter, techFilter, setTechFilter,
}: {
  loading: boolean; error: string | null; reports: ReportSummary[] | null;
  onOpen: (id: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (s: StatusFilter) => void;
  techFilter: string;
  setTechFilter: (t: string) => void;
}) {
  const techOptions = useMemo(() => {
    const set = new Set<string>();
    (reports || []).forEach((r) => { if (r.techName) set.add(r.techName); });
    return Array.from(set).sort();
  }, [reports]);

  // The full set of reports rendered in the table — when filtering by tech,
  // ALL of that tech's reports show so the user can tick which to roll up.
  const visibleReports = useMemo(
    () => (reports || []).filter((r) => !techFilter || r.techName === techFilter),
    [reports, techFilter]
  );

  // Selected report ids (keyed by report.id). Empty set = "include all" in overview.
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set());
  // Reset selection whenever the tech changes.
  useEffect(() => { setSelectedReportIds(new Set()); }, [techFilter]);

  const toggleReport = (id: string) => {
    setSelectedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // The reports actually summed in the overview totals: marked ones only,
  // or all visible ones if nothing is marked.
  const overviewSource = useMemo(
    () => selectedReportIds.size === 0 ? visibleReports : visibleReports.filter((r) => selectedReportIds.has(r.id)),
    [visibleReports, selectedReportIds]
  );

  const overviewTotals = useMemo(() => overviewSource.reduce(
    (acc, r) => ({
      sales: acc.sales + (r.supabaseTotalSales || 0),
      balance: acc.balance + (r.supabaseBalance || 0),
      tips: acc.tips + (r.supabaseTips || 0),
      commission: acc.commission + (r.supabaseCommission || 0),
      jobs: acc.jobs + (r.supabaseJobCount || 0),
    }),
    { sales: 0, balance: 0, tips: 0, commission: 0, jobs: 0 }
  ), [overviewSource]);
  return (
    <main className="balance-page">
      <div className="content">
        <header className="bp-header animate-fade-up">
          <div className="bp-header-left">
            <p className="bp-kicker">Verification</p>
            <h1 className="bp-title">Verify Weekly Reports</h1>
            <div className="bp-meta">
              <span className="bp-meta-chip">
                <span className="bp-meta-chip-label">Source</span>
                <strong>Lovable Balance App (Supabase)</strong>
              </span>
              {reports && (
                <span className="bp-meta-chip">
                  <span className="bp-meta-chip-label">Awaiting</span>
                  <strong>{reports.length} reports</strong>
                </span>
              )}
            </div>
          </div>
          <div className="bp-header-right" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href="/verify-reports/week-control"
              className="pmr-clear-btn"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            >
              <FiCalendar size={14} />
              <span>Week Control</span>
            </Link>
            <Link
              href="/verify-reports/mappings"
              className="pmr-clear-btn"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            >
              <FiUsers size={14} />
              <span>Manage Mappings</span>
            </Link>
          </div>
        </header>

        {error && (
          <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'rgba(239,68,68,0.4)' }}>
            <p style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
              Couldn't load reports
            </p>
            <pre style={{ color: '#f87171', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
            {error.toLowerCase().includes('supabase not configured') && (
              <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 10 }}>
                The Lovable Balance backend isn't connected yet. Add <code>SUPABASE_URL</code> and{' '}
                <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code>, then restart the dev server.
              </p>
            )}
          </div>
        )}

        <div className="bp-cv-tabs animate-fade-up" style={{ marginBottom: 12 }}>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              className={`bp-cv-tab ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
              disabled={!!techFilter}
              title={techFilter ? 'Clear tech filter to switch status' : undefined}
              style={techFilter ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Tech History
          </span>
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            style={{
              background: 'rgba(15,23,42,0.5)',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 13,
              minWidth: 200,
            }}
          >
            <option value="">— All techs —</option>
            {techOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {techFilter && (
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999,
                background: 'rgba(99,102,241,0.18)',
                border: '1px solid rgba(99,102,241,0.35)',
                color: '#c7d2fe', fontSize: 12, fontWeight: 500,
              }}
            >
              Viewing all weeks for <strong>{techFilter}</strong>
              <button
                onClick={() => setTechFilter('')}
                style={{ background: 'transparent', border: 'none', color: '#c7d2fe', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                aria-label="Clear tech filter"
              >
                <FiX size={12} />
              </button>
            </span>
          )}
        </div>

        {techFilter && visibleReports.length > 0 && (
          <div className="panel animate-fade-up" style={{ padding: 16, marginBottom: 12 }}>
            <p className="bp-section-kicker" style={{ margin: 0 }}>Tech Overview</p>
            <h3 style={{ marginTop: 4, marginBottom: 12 }}>
              {techFilter}
              <span style={{ color: '#64748b', fontWeight: 400, fontSize: 13 }}>
                {' · '}
                {selectedReportIds.size > 0
                  ? <>{selectedReportIds.size} of {visibleReports.length} reports selected</>
                  : <>{visibleReports.length} reports (all)</>}
                {' · '}
                {overviewTotals.jobs} jobs
              </span>
              {selectedReportIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedReportIds(new Set())}
                  style={{ marginLeft: 12, background: 'transparent', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}
                >
                  Clear selection
                </button>
              )}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <OverviewStat label="Total Sales"              value={formatCurrency(overviewTotals.sales)}      />
              <OverviewStat label="Total Balance"            value={formatCurrency(overviewTotals.balance)}    accent={overviewTotals.balance < 0 ? '#f87171' : overviewTotals.balance > 0 ? '#34d399' : undefined} />
              <OverviewStat label="Tips"                     value={formatCurrency(overviewTotals.tips)}       />
              <OverviewStat label="Commission (Tech Payout)" value={formatCurrency(overviewTotals.commission)} accent="#a5b4fc" />
            </div>
          </div>
        )}

        <div className="panel bp-table-panel animate-fade-up">
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">Inbox</p>
              <h3>
                {techFilter
                  ? `${techFilter} — all weeks`
                  : (statusFilter === 'All' ? 'All weekly reports' : `${statusFilter} reports`)}
              </h3>
            </div>
            <span className="bp-pill">{visibleReports.length} {statusFilter === 'Submitted' && !techFilter ? 'pending' : 'shown'}</span>
          </div>
          <div className="balance-table" style={{ position: 'relative' }}>
            {loading && !reports && <LoadingOverlay message="Loading reports from Supabase..." />}
            <table>
              <thead>
                <tr>
                  {techFilter && <th style={{ width: 36 }}></th>}
                  <th>Tech</th>
                  <th>Area</th>
                  <th>Week</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Jobs</th>
                  <th>Total Sales</th>
                  <th>Balance</th>
                  <th>Tips</th>
                  <th>Commission</th>
                  <th>CRM match</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleReports.map((r) => (
                  <tr
                    key={r.id}
                    className="pmr-tech-row"
                    onClick={() => onOpen(r.id)}
                    role="button"
                    style={selectedReportIds.has(r.id) ? { background: 'rgba(99,102,241,0.06)' } : undefined}
                  >
                    {techFilter && (
                      <td
                        onClick={(e) => { e.stopPropagation(); toggleReport(r.id); }}
                        title="Include this report in the overview totals"
                        style={{ cursor: 'pointer', textAlign: 'center' }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedReportIds.has(r.id)}
                          onChange={() => toggleReport(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: '#6366f1', cursor: 'pointer' }}
                        />
                      </td>
                    )}
                    <td onClick={(e) => { e.stopPropagation(); if (r.techName) setTechFilter(r.techName); }}
                        title={r.techName ? `Show all weeks for ${r.techName}` : undefined}
                        style={{ cursor: r.techName ? 'pointer' : undefined, color: techFilter === r.techName ? '#a5b4fc' : undefined, fontWeight: techFilter === r.techName ? 600 : undefined }}>
                      {r.techName || '—'}
                    </td>
                    <td>{r.areaName || '—'}</td>
                    <td>{formatDisplayDate(r.weekStart)} → {formatDisplayDate(r.weekEnd)}</td>
                    <td>
                      {r.status}
                      {r.resubmitted && (
                        <span
                          title="Returned, then edited again by the tech — treat as a re-submission"
                          style={{
                            marginLeft: 6, padding: '1px 6px', borderRadius: 6, fontSize: 11,
                            fontWeight: 600, background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
                            border: '1px solid rgba(245,158,11,0.35)', whiteSpace: 'nowrap',
                          }}
                        >
                          resubmitted
                        </span>
                      )}
                    </td>
                    <td>{r.submittedAt ? formatDisplayDate(r.submittedAt.slice(0, 10)) : '—'}</td>
                    <td>{r.supabaseJobCount}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(r.supabaseTotalSales)}</td>
                    <td style={{
                      color: (r.supabaseBalance ?? 0) < 0 ? '#f87171' : (r.supabaseBalance ?? 0) > 0 ? '#34d399' : undefined,
                      fontWeight: (r.supabaseBalance ?? 0) !== 0 ? 600 : undefined,
                    }}>
                      {formatCurrency(r.supabaseBalance || 0)}
                    </td>
                    <td>{formatCurrency(r.supabaseTips || 0)}</td>
                    <td style={{ color: '#a5b4fc', fontWeight: 600 }}>{formatCurrency(r.supabaseCommission || 0)}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Badge ok={r.techMatched} label="tech" />
                        <Badge ok={r.areaMatched} label="area" />
                      </span>
                    </td>
                    <td className="pmr-row-action">Verify <FiChevronRight style={{ verticalAlign: 'middle' }} /></td>
                  </tr>
                ))}
                {!loading && reports && visibleReports.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={techFilter ? 13 : 12}>
                      <EmptyState
                        size="md"
                        title={techFilter ? `No reports for ${techFilter}` : 'No reports awaiting verification'}
                        message={techFilter ? 'This tech has no submitted weekly reports yet.' : 'When techs or area managers submit a weekly report, it will appear here.'}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── DETAIL VIEW ────────────────────────────────────────────────────────────

function DetailView({
  loading, error, data, onBack, onRefresh,
}: {
  loading: boolean; error: string | null; data: DetailResponse | null;
  onBack: () => void;
  onRefresh: () => void;
}) {
  return (
    <main className="balance-page">
      <div className="content">
        <header className="bp-header animate-fade-up">
          <div className="bp-header-left">
            <button onClick={onBack} className="pmr-clear-btn" style={{ marginBottom: 12 }}>
              <FiArrowLeft style={{ verticalAlign: 'middle', marginRight: 6 }} />Back to list
            </button>
            <p className="bp-kicker">Verification</p>
            <h1 className="bp-title">
              {data?.report.techName || (loading ? 'Loading…' : 'Report')}
            </h1>
            {data?.report && (
              <div className="bp-meta">
                <span className="bp-meta-chip">
                  <span className="bp-meta-chip-label">Area</span>
                  <strong>{data.report.areaName || '—'}</strong>
                </span>
                <span className="bp-meta-chip">
                  <span className="bp-meta-chip-label">Week</span>
                  <strong>{formatDisplayDate(data.report.weekStart)} → {formatDisplayDate(data.report.weekEnd)}</strong>
                </span>
                <span className="bp-meta-chip">
                  <span className="bp-meta-chip-label">Status</span>
                  <strong>{data.report.status}</strong>
                </span>
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'rgba(239,68,68,0.4)' }}>
            <pre style={{ color: '#f87171', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
          </div>
        )}

        {loading && !data && (
          <div className="panel" style={{ padding: 24, position: 'relative', minHeight: 120 }}>
            <LoadingOverlay message="Comparing report against CRM..." />
          </div>
        )}

        {data && (
          <>
            <IdentityCard report={data.report} />
            <ReportNoteCard report={data.report} />
            <SummaryCard summary={data.summary} totals={data.totals} />
            <PairsTable pairs={data.pairs} reportId={data.report.id} onRefresh={onRefresh} />
            <ActionsCard
              reportId={data.report.id}
              currentStatus={data.report.status}
              onRefresh={onRefresh}
            />
          </>
        )}
      </div>
    </main>
  );
}

function IdentityCard({ report }: { report: DetailResponse['report'] }) {
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 0.6, marginBottom: 10 }}>
        Identity check
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <IdentityRow ok={report.techMatched} ok_label={`Tech "${report.techName}" found in CRM`} bad_label={`Tech "${report.techName}" not found in CRM — all line items will appear as missing-in-CRM`} />
        <IdentityRow ok={report.areaMatched} ok_label={`Area "${report.areaName}" found in CRM`} bad_label={`Area "${report.areaName}" not found in CRM`} />
      </div>
    </div>
  );
}

function IdentityRow({ ok, ok_label, bad_label }: { ok: boolean; ok_label: string; bad_label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      {ok
        ? <FiCheckCircle color="#34d399" />
        : <FiAlertTriangle color="#fbbf24" />}
      <span style={{ color: ok ? '#cbd5e1' : '#fbbf24' }}>{ok ? ok_label : bad_label}</span>
    </div>
  );
}

function SummaryCard({ summary, totals }: { summary: DetailResponse['summary']; totals: DetailResponse['totals'] }) {
  const rows = [
    { label: 'Total Job',  sup: totals.supabase.totalJob,    crm: totals.crm.totalAmount,         diff: totals.diffs.totalJob },
    { label: 'Card',       sup: totals.supabase.cardAmount,  crm: totals.crm.totalPaidCard,       diff: totals.diffs.card },
    { label: 'Tech Cash',  sup: totals.supabase.techCash,    crm: totals.crm.techPaidCash,        diff: totals.diffs.techCash },
    { label: 'Co. Cash',   sup: totals.supabase.companyCash, crm: totals.crm.totalPaidCompanyCash,diff: totals.diffs.companyCash },
    { label: 'Tips',       sup: totals.supabase.tips,        crm: totals.crm.tipsTotal,           diff: totals.diffs.tips },
    { label: 'My Parts',   sup: totals.supabase.myParts,     crm: totals.crm.techParts,           diff: totals.diffs.myParts },
    { label: 'Co. Parts',  sup: totals.supabase.companyParts,crm: totals.crm.companyParts,        diff: totals.diffs.companyParts },
    { label: 'LM Cash',    sup: totals.supabase.lmCash,      crm: totals.crm.lmCash,              diff: totals.diffs.lmCash },
    { label: 'LM Check',   sup: totals.supabase.lmCheck,     crm: totals.crm.lmCheck,             diff: totals.diffs.lmCheck },
    { label: 'LM Parts',   sup: totals.supabase.lmParts,     crm: totals.crm.lmParts,             diff: totals.diffs.lmParts },
  ];

  const crmExtras = [
    { label: 'Co. Check (CRM-only)', value: totals.crm.totalPaidCompanyCheck },
    { label: 'Finance (CRM-only)',   value: totals.crm.totalPaidFinance },
  ].filter((e) => e.value > 0);

  const colorForDiff = (d: number) => Math.abs(d) > 1 ? '#fbbf24' : '#34d399';

  return (
    <div className="panel bp-table-panel animate-fade-up" style={{ marginBottom: 12 }}>
      <div className="panel-header">
        <div>
          <p className="bp-section-kicker">Summary</p>
          <h3>Totals comparison</h3>
        </div>
        <span className="bp-pill" style={{ background: summary.mismatched + summary.missingInCrm + summary.missingInReport > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)' }}>
          ✓ {summary.matched} match · ⚠ {summary.mismatched} mismatch · ✗ {summary.missingInCrm} CRM-only · ✗ {summary.missingInReport} Report-only
        </span>
      </div>
      <div className="balance-table">
        <table>
          <thead>
            <tr>
              <th></th>
              <th style={{ textAlign: 'right' }}>Reported (Supabase)</th>
              <th style={{ textAlign: 'right' }}>CRM (MongoDB)</th>
              <th style={{ textAlign: 'right' }}>Diff (CRM − Reported)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Jobs</td>
              <td style={{ textAlign: 'right' }}>{summary.supabaseJobCount}</td>
              <td style={{ textAlign: 'right' }}>{summary.crmJobCount}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{summary.crmJobCount - summary.supabaseJobCount > 0 ? '+' : ''}{summary.crmJobCount - summary.supabaseJobCount}</td>
              <td></td>
            </tr>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(r.sup)}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(r.crm)}</td>
                <td style={{ textAlign: 'right', color: colorForDiff(r.diff), fontWeight: 600 }}>
                  {r.diff > 0 ? '+' : ''}{formatCurrency(r.diff)}
                </td>
                <td>{Math.abs(r.diff) > 1 ? <FiAlertTriangle color="#fbbf24" /> : <FiCheck color="#34d399" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {crmExtras.length > 0 && (
          <div style={{ padding: '8px 14px 14px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
              CRM has these payment fields that the Lovable app doesn't track (informational only):
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {crmExtras.map((e) => (
                <span key={e.label} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: '#cbd5e1' }}>
                  {e.label}: {formatCurrency(e.value)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PairsTable({ pairs, reportId, onRefresh }: { pairs: Pair[]; reportId: string; onRefresh: () => void }) {
  const [filter, setFilter] = useState<'all' | 'mismatch' | 'missing'>('all');
  const [editing, setEditing] = useState<any | null>(null); // SupabaseReportJob
  // When set, the Link picker modal is open for the given Lovable supabase job.
  const [linkingFor, setLinkingFor] = useState<any | null>(null);

  // Picker pool: ALL CRM jobs in this report's window (matched + unmatched),
  // tagged with what they're currently paired to so admins can override an
  // existing auto-match if needed.
  const allCrmJobOptions = useMemo(() => {
    return pairs
      .filter((p) => p.crmJob)
      .map((p) => ({
        crm: p.crmJob,
        currentlyPairedWith: p.supabaseJob
          ? { address: p.supabaseJob.address || null, customer: p.supabaseJob.customer_name || null }
          : null,
      }));
  }, [pairs]);
  const filtered = useMemo(() => {
    if (filter === 'all') return pairs;
    if (filter === 'mismatch') return pairs.filter((p) => p.status === 'mismatch');
    return pairs.filter((p) => p.status === 'missing-in-crm' || p.status === 'missing-in-report');
  }, [pairs, filter]);

  return (
    <div className="panel bp-table-panel animate-fade-up" style={{ marginBottom: 12 }}>
      <div className="panel-header">
        <div>
          <p className="bp-section-kicker">Per-job comparison</p>
          <h3>Line items</h3>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>All ({pairs.length})</FilterPill>
          <FilterPill active={filter === 'mismatch'} onClick={() => setFilter('mismatch')}>Mismatched only</FilterPill>
          <FilterPill active={filter === 'missing'} onClick={() => setFilter('missing')}>Missing only</FilterPill>
        </div>
      </div>
      <div className="balance-table">
        <table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 160 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
            <col />
            <col style={{ width: 240 }} />
            <col style={{ width: 56 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Status</th>
              <th style={{ textAlign: 'left' }}>Date</th>
              <th style={{ textAlign: 'left' }}>Address &amp; customer</th>
              <th style={{ textAlign: 'left' }}>Method</th>
              <th style={{ textAlign: 'right' }}>Reported $</th>
              <th style={{ textAlign: 'right' }}>CRM $</th>
              <th style={{ textAlign: 'left', paddingLeft: 20 }}>Discrepancies</th>
              <th style={{ textAlign: 'left', paddingLeft: 0 }}>Admin Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <PairRow
                key={i}
                pair={p}
                reportId={reportId}
                onEdit={() => p.supabaseJob && setEditing(p.supabaseJob)}
                onStartLink={() => p.supabaseJob && setLinkingFor(p.supabaseJob)}
                onUnlink={async () => {
                  if (!p.supabaseJob) return;
                  await fetch(`/api/verify/weekly-reports/${reportId}/jobs/${p.supabaseJob.id}/link`, { method: 'DELETE' });
                  onRefresh();
                }}
              />
            ))}
            {filtered.length === 0 && (
              <tr className="empty-row"><td colSpan={9}><EmptyState size="sm" title="Nothing to show in this filter" /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditJobModal
          job={editing}
          reportId={reportId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onRefresh(); }}
        />
      )}

      {linkingFor && (
        <LinkPickerModal
          job={linkingFor}
          reportId={reportId}
          options={allCrmJobOptions}
          onClose={() => setLinkingFor(null)}
          onLinked={() => { setLinkingFor(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function PairRow({ pair, reportId, onEdit, onStartLink, onUnlink }: {
  pair: Pair; reportId: string;
  onEdit: () => void;
  onStartLink: () => void;
  onUnlink: () => void;
}) {
  const date = pair.supabaseJob?.job_date || pair.crmJob?.date || '';
  const address = pair.supabaseJob?.address || pair.crmJob?.address || '';
  const customer = pair.supabaseJob?.customer_name || pair.crmJob?.clientName || '';
  const sup = pair.supabaseJob?.total_job;
  const crm = pair.crmJob?.totalAmount;

  const statusBadge = (() => {
    switch (pair.status) {
      case 'match':              return <span style={pillStyle('#34d399')}><FiCheck /> match</span>;
      case 'mismatch':           return <span style={pillStyle('#fbbf24')}><FiAlertTriangle /> mismatch</span>;
      case 'missing-in-crm':     return <span style={pillStyle('#f87171')}><FiX /> CRM-only missing</span>;
      case 'missing-in-report':  return <span style={pillStyle('#f87171')}><FiX /> Report-only missing</span>;
    }
  })();

  return (
    <tr>
      <td style={{ textAlign: 'left' }}>{statusBadge}</td>
      <td style={{ textAlign: 'left' }}>{date ? formatDisplayDate(date) : '—'}</td>
      <td style={{ textAlign: 'left', overflow: 'hidden' }}>
        <div title={address || '—'} style={truncStyle}>{address || '—'}</div>
        {customer && (
          <div title={customer} style={{ ...truncStyle, fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            {customer}
          </div>
        )}
      </td>
      <td style={{ textAlign: 'left' }}>
        <PaymentMethodCell pair={pair} />
      </td>
      <td style={{ textAlign: 'right' }}>{sup !== undefined ? formatCurrency(sup) : '—'}</td>
      <td style={{ textAlign: 'right' }}>{crm !== undefined ? formatCurrency(crm) : '—'}</td>
      <td style={{ textAlign: 'left', paddingLeft: 20 }}>
        {pair.status === 'mismatch' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            {pair.methodDiff && (
              <span style={{ color: '#fbbf24' }}>
                Payment method: reported <strong>{pair.methodDiff.supabase || '—'}</strong> · CRM <strong>{pair.methodDiff.crm || '—'}</strong>
              </span>
            )}
            {pair.diffs.filter((d) => d.exceedsTolerance).map((d) => (
              <span key={d.field} style={{ color: '#fbbf24' }}>
                {d.label}: reported {formatCurrency(d.supabase)} · CRM {formatCurrency(d.crm)} · {d.diff > 0 ? '+' : ''}{formatCurrency(d.diff)}
              </span>
            ))}
          </div>
        )}
        {pair.status === 'missing-in-crm' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Tech reported, CRM has no record</span>
            <button
              type="button"
              onClick={onStartLink}
              style={{
                fontSize: 11, fontWeight: 600,
                padding: '3px 8px', borderRadius: 6,
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.35)',
                color: '#c7d2fe', cursor: 'pointer',
              }}
            >
              Link to CRM job →
            </button>
          </span>
        )}
        {pair.status === 'missing-in-report' && <span style={{ fontSize: 12, color: '#94a3b8' }}>CRM has it, tech didn't report</span>}
        {pair.status === 'match' && <span style={{ fontSize: 12, color: '#34d399' }}>All within $1 tolerance</span>}
        {pair.manualLink && pair.supabaseJob && (
          <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(99,102,241,0.18)', color: '#c7d2fe',
                border: '1px solid rgba(99,102,241,0.35)',
              }}
              title="Pair set manually by an admin (overrides auto-matcher)"
            >
              Manually linked
            </span>
            <button
              type="button"
              onClick={onUnlink}
              style={{
                background: 'transparent', border: 'none',
                color: '#94a3b8', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', padding: 0, textDecoration: 'underline',
              }}
            >
              Unlink
            </button>
          </div>
        )}
      </td>
      <td style={{ verticalAlign: 'top', paddingTop: 8, paddingLeft: 0, textAlign: 'left' }}>
        {(() => {
          // Prefer the supabase job's id when present (matched/mismatch/
          // missing-in-crm); fall back to the CRM ObjectId for missing-in-
          // report rows so admins can also annotate those.
          const noteOwner = pair.supabaseJob || pair.crmJob;
          if (!noteOwner) return <span style={{ fontSize: 11, color: '#475569' }}>—</span>;
          const jobId = pair.supabaseJob?.id ?? pair.crmJob?._id;
          return (
            <JobNoteInline
              reportId={reportId}
              jobId={jobId}
              initial={(noteOwner as any).adminNote || ''}
            />
          );
        })()}
      </td>
      <td style={{ textAlign: 'center' }}>
        {pair.supabaseJob && (
          <button
            onClick={onEdit}
            title="Edit reported job"
            aria-label="Edit reported job"
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
              color: '#94a3b8', padding: 6, borderRadius: 6, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#a5b4fc'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(165,180,252,0.4)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)'; }}
          >
            <FiEdit2 size={13} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── PAYMENT METHOD ─────────────────────────────────────────────────────────

function PaymentMethodCell({ pair }: { pair: Pair }) {
  const sup = pair.supabaseJob?.payment_type || null;
  // The API already pre-computes paymentType on each crmJob (same logic, same
  // labels), so just read it back.
  const crm: string | null = pair.crmJob?.paymentType ?? null;
  const same = sup && crm && sup.toLowerCase() === crm.toLowerCase();
  if (same) {
    return <span style={methodPillStyle('#a5b4fc')}>{sup}</span>;
  }
  if (sup && crm) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
        <span style={methodPillStyle('#a5b4fc')}>{sup}</span>
        <span style={{ ...methodPillStyle('#94a3b8'), opacity: 0.85 }}>CRM: {crm}</span>
      </div>
    );
  }
  if (sup) return <span style={methodPillStyle('#a5b4fc')}>{sup}</span>;
  if (crm) return <span style={methodPillStyle('#94a3b8')}>{crm}</span>;
  return <span style={{ color: '#475569', fontSize: 12 }}>—</span>;
}

function methodPillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 999,
    fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
    background: color + '18', color, border: `1px solid ${color}40`,
  };
}

// ─── EDIT JOB MODAL ─────────────────────────────────────────────────────────

type EditableJob = {
  id: string;
  job_date: string;
  customer_name: string | null;
  address: string | null;
  notes?: string | null;
  tech_paid_cash?: number;
  paid_card?: number;
  paid_company_cash?: number;
  paid_company_check?: number;
  paid_finance?: number;
  tech_parts?: number;
  company_parts?: number;
  tips_card?: number;
  tips_finance?: number;
  tips_company_cash?: number;
  tips_check?: number;
  commission_rate?: number;
  lm_cash?: number;
  lm_check?: number;
  lm_parts?: number;
};

function EditJobModal({
  job, reportId, onClose, onSaved,
}: {
  job: EditableJob;
  reportId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditableJob>(() => ({ ...job }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live total preview — sum of all payment fields (matches the CRM's
  // calcPaidSum: includes lm_cash + lm_check).
  const total = useMemo(() => (
    (Number(form.tech_paid_cash) || 0) +
    (Number(form.paid_card) || 0) +
    (Number(form.paid_company_cash) || 0) +
    (Number(form.paid_company_check) || 0) +
    (Number(form.paid_finance) || 0) +
    (Number(form.lm_cash) || 0) +
    (Number(form.lm_check) || 0)
  ), [form]);

  const partsTotal = useMemo(() => (
    (Number(form.tech_parts) || 0) +
    (Number(form.company_parts) || 0) +
    (Number(form.lm_parts) || 0)
  ), [form]);

  const tipsTotal = useMemo(() => (
    (Number(form.tips_card) || 0) +
    (Number(form.tips_finance) || 0) +
    (Number(form.tips_company_cash) || 0) +
    (Number(form.tips_check) || 0)
  ), [form]);

  const setNum = (k: keyof EditableJob) => (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/[^0-9.]/g, '');
    const dot = v.indexOf('.');
    if (dot !== -1) {
      v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
    }
    setForm((p) => ({ ...p, [k]: v === '' ? 0 : Number(v) }));
  };

  const setText = (k: keyof EditableJob) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((p) => ({ ...p, [k]: e.target.value }));
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        job_date: form.job_date,
        customer_name: form.customer_name,
        address: form.address,
        notes: form.notes,
        tech_paid_cash: Number(form.tech_paid_cash) || 0,
        paid_card: Number(form.paid_card) || 0,
        paid_company_cash: Number(form.paid_company_cash) || 0,
        paid_company_check: Number(form.paid_company_check) || 0,
        paid_finance: Number(form.paid_finance) || 0,
        tech_parts: Number(form.tech_parts) || 0,
        company_parts: Number(form.company_parts) || 0,
        tips_card: Number(form.tips_card) || 0,
        tips_finance: Number(form.tips_finance) || 0,
        tips_company_cash: Number(form.tips_company_cash) || 0,
        tips_check: Number(form.tips_check) || 0,
        commission_rate: Number(form.commission_rate) || 0,
        lm_cash: Number(form.lm_cash) || 0,
        lm_check: Number(form.lm_check) || 0,
        lm_parts: Number(form.lm_parts) || 0,
      };
      const res = await fetch(`/api/verify/weekly-reports/${reportId}/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      onSaved();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(2,6,23,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640,
          background: '#0d1526', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: 20,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <p className="bp-section-kicker">Edit reported job</p>
            <h3 style={{ margin: '4px 0 0', color: '#e2e8f0' }}>Job details</h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Saves to Supabase. Derived totals are recomputed automatically.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={modalCloseStyle}><FiX size={16} /></button>
        </div>

        {error && (
          <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Date">
            <input type="date" value={form.job_date} onChange={setText('job_date')} style={inputStyle} />
          </Field>
          <Field label="Customer">
            <input type="text" value={form.customer_name || ''} onChange={setText('customer_name')} style={inputStyle} />
          </Field>
          <Field label="Address" full>
            <input type="text" value={form.address || ''} onChange={setText('address')} style={inputStyle} />
          </Field>

          <SectionLabel>Payments</SectionLabel>
          <NumField label="Card" v={form.paid_card} onChange={setNum('paid_card')} />
          <NumField label="Tech cash" v={form.tech_paid_cash} onChange={setNum('tech_paid_cash')} />
          <NumField label="Company cash" v={form.paid_company_cash} onChange={setNum('paid_company_cash')} />
          <NumField label="Company check" v={form.paid_company_check} onChange={setNum('paid_company_check')} />
          <NumField label="Finance" v={form.paid_finance} onChange={setNum('paid_finance')} />
          <NumField label="LM cash" v={form.lm_cash} onChange={setNum('lm_cash')} />
          <NumField label="LM check" v={form.lm_check} onChange={setNum('lm_check')} />
          <Field label="Total (computed)"><div style={readonlyStyle}>${total.toFixed(2)}</div></Field>

          <SectionLabel>Parts</SectionLabel>
          <NumField label="Tech parts (My Parts)" v={form.tech_parts} onChange={setNum('tech_parts')} />
          <NumField label="Company parts" v={form.company_parts} onChange={setNum('company_parts')} />
          <NumField label="LM parts" v={form.lm_parts} onChange={setNum('lm_parts')} />
          <Field label="Parts total (computed)"><div style={readonlyStyle}>${partsTotal.toFixed(2)}</div></Field>

          <SectionLabel>Tips</SectionLabel>
          <NumField label="Tips on card" v={form.tips_card} onChange={setNum('tips_card')} />
          <NumField label="Tips on finance" v={form.tips_finance} onChange={setNum('tips_finance')} />
          <NumField label="Tips company cash" v={form.tips_company_cash} onChange={setNum('tips_company_cash')} />
          <NumField label="Tips on check" v={form.tips_check} onChange={setNum('tips_check')} />
          <Field label="Tips total (computed)"><div style={readonlyStyle}>${tipsTotal.toFixed(2)}</div></Field>

          <SectionLabel>Commission</SectionLabel>
          <Field label="Commission rate (%) — overrides tech default for this job only" full>
            <input
              type="text"
              inputMode="decimal"
              value={form.commission_rate ?? ''}
              onChange={setNum('commission_rate')}
              placeholder="e.g. 30 for 30%"
              style={inputStyle}
            />
          </Field>

          <Field label="Notes" full>
            <textarea
              rows={3}
              value={form.notes || ''}
              onChange={setText('notes')}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} disabled={saving} className="pmr-clear-btn">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="pmr-clear-btn"
            style={{
              background: 'rgba(99,102,241,0.18)',
              borderColor: 'rgba(99,102,241,0.5)',
              color: '#c7d2fe',
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function NumField({ label, v, onChange }: { label: string; v: number | undefined; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <Field label={label}>
      <input type="text" inputMode="decimal" value={v ?? 0} onChange={onChange} style={inputStyle} />
    </Field>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'rgba(15,23,42,0.5)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

const readonlyStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'rgba(15,23,42,0.3)', color: '#94a3b8',
  border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
};

const modalCloseStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
  color: '#94a3b8', padding: 6, borderRadius: 6, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function ActionsCard({
  reportId, currentStatus, onRefresh,
}: { reportId: string; currentStatus: string; onRefresh: () => void }) {
  const [busy, setBusy] = useState<null | 'Approved' | 'Under Review' | 'Returned'>(null);
  const [error, setError] = useState<string | null>(null);

  const patchStatus = async (status: 'Approved' | 'Under Review' | 'Returned', note?: string) => {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch(`/api/verify/weekly-reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      onRefresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to update status');
    } finally {
      setBusy(null);
    }
  };

  const handleReturn = () => {
    const reason = typeof window !== 'undefined'
      ? window.prompt('Reason for returning this report? (optional — added to the admin note)')
      : null;
    // window.prompt returns null on cancel; treat as "abort".
    if (reason === null) return;
    void patchStatus('Returned', reason || undefined);
  };

  const isCurrent = (s: string) => currentStatus === s;

  return (
    <div className="panel" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FiHelpCircle color="#94a3b8" />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {error
            ? <span style={{ color: '#f87171' }}>{error}</span>
            : <>Current status: <strong style={{ color: '#e2e8f0' }}>{currentStatus}</strong></>}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="bp-cv-reset"
          disabled={busy !== null || isCurrent('Approved')}
          onClick={() => void patchStatus('Approved')}
          title={isCurrent('Approved') ? 'Already approved' : 'Mark this report as Approved'}
        >
          {busy === 'Approved' ? '…' : '✓'} Approve
        </button>
        <button
          className="bp-cv-reset"
          disabled={busy !== null || isCurrent('Under Review')}
          onClick={() => void patchStatus('Under Review')}
          title={isCurrent('Under Review') ? 'Already under review' : 'Move this report back to Under Review'}
        >
          {busy === 'Under Review' ? '…' : '↻'} Under Review
        </button>
        <button
          className="bp-cv-reset"
          disabled={busy !== null || isCurrent('Returned')}
          onClick={handleReturn}
          title={isCurrent('Returned') ? 'Already returned' : 'Return this report to the technician with an optional reason'}
        >
          {busy === 'Returned' ? '…' : '↩'} Return…
        </button>
      </div>
    </div>
  );
}

// ─── small helpers ──────────────────────────────────────────────────────────

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11,
      background: ok ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
      color: ok ? '#34d399' : '#f87171',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'}`,
    }}>
      {ok ? <FiCheck size={10} /> : <FiX size={10} />} {label}
    </span>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer',
        background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.10)'}`,
        color: active ? '#c7d2fe' : '#cbd5e1',
      }}
    >
      {children}
    </button>
  );
}

const truncStyle: React.CSSProperties = {
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
};

function pillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999,
    fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    background: color + '20', color, border: `1px solid ${color}66`,
  };
}

function OverviewStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 14px' }}>
      <p style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: accent || '#f1f5f9', marginTop: 4, marginBottom: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  );
}


// ─── ADMIN NOTES (CRM-only, never sent to Lovable / tech app) ──────────────

function ReportNoteCard({ report }: { report: DetailResponse['report'] }) {
  const [value, setValue] = useState(report.adminNote || '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(report.adminNoteUpdatedAt || null);
  const [savedBy, setSavedBy] = useState<string | null>(report.adminNoteUpdatedBy || null);
  const [err, setErr] = useState<string | null>(null);
  const initialRef = useRef(report.adminNote || '');
  const dirty = value !== initialRef.current;

  // If the underlying report changes (different report opened), reset state.
  useEffect(() => {
    setValue(report.adminNote || '');
    initialRef.current = report.adminNote || '';
    setSavedAt(report.adminNoteUpdatedAt || null);
    setSavedBy(report.adminNoteUpdatedBy || null);
  }, [report.id, report.adminNote, report.adminNoteUpdatedAt, report.adminNoteUpdatedBy]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/verify/weekly-reports/${report.id}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: value }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      initialRef.current = value;
      setSavedAt(new Date().toISOString());
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'rgba(245,158,11,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p className="bp-section-kicker" style={{ margin: 0 }}>Admin Note · CRM only</p>
          <h3 style={{ marginTop: 4, marginBottom: 0, fontSize: 15 }}>Notes about this report</h3>
        </div>
        {savedAt && (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Last saved {formatDisplayDate(savedAt.slice(0, 10))}{savedBy ? ` · ${savedBy}` : ''}
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Internal notes — not visible to the tech in Lovable."
        rows={3}
        style={{
          width: '100%',
          background: 'rgba(15,23,42,0.6)',
          color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 10,
          padding: 10,
          fontSize: 13,
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="pmr-clear-btn"
          style={{
            opacity: !dirty || saving ? 0.5 : 1,
            cursor: !dirty || saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : dirty ? 'Save note' : 'Saved'}
        </button>
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>
    </div>
  );
}

function JobNoteInline({ reportId, jobId, initial }: { reportId: string; jobId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 'collapsed' = read-only display (or "+ Add" prompt); 'editing' = textarea
  const [mode, setMode] = useState<'collapsed' | 'editing'>('collapsed');
  const initialRef = useRef(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skipNextBlurSaveRef = useRef(false);
  const dirty = value !== initialRef.current;

  // Re-sync if the underlying note changes (e.g. report refetched).
  useEffect(() => { setValue(initial); initialRef.current = initial; setMode('collapsed'); }, [initial]);

  // Auto-focus the textarea when entering edit mode.
  useEffect(() => {
    if (mode === 'editing') {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [mode]);

  const save = async (next: string) => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/verify/weekly-reports/${reportId}/jobs/${jobId}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      initialRef.current = next;
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const commitAndClose = async () => {
    if (dirty) await save(value);
    setMode('collapsed');
  };

  // ── Collapsed view ───────────────────────────────────────────────────────
  if (mode === 'collapsed') {
    if (!initialRef.current) {
      return (
        <button
          type="button"
          onClick={() => setMode('editing')}
          style={{
            background: 'transparent', border: 'none',
            color: '#fbbf24', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', padding: 0,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          + Add admin note
        </button>
      );
    }
    // Has a saved note — show it read-only with an Edit button.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.20)',
            borderRadius: 8, padding: '6px 8px',
            fontSize: 12, color: '#e2e8f0',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {initialRef.current}
        </div>
        <button
          type="button"
          onClick={() => setMode('editing')}
          style={{
            alignSelf: 'flex-start',
            background: 'rgba(245,158,11,0.10)',
            border: '1px solid rgba(245,158,11,0.30)',
            color: '#fbbf24', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', padding: '3px 8px', borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          <FiEdit2 size={11} />
          Edit note
        </button>
      </div>
    );
  }

  // ── Editing view ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        Admin note · Enter to save · Shift+Enter for new line
      </span>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Skip the blur-triggered save (commitAndClose handles it).
            skipNextBlurSaveRef.current = true;
            commitAndClose();
          } else if (e.key === 'Escape') {
            // Cancel: revert and close without saving.
            e.preventDefault();
            skipNextBlurSaveRef.current = true;
            setValue(initialRef.current);
            setMode('collapsed');
          }
        }}
        onBlur={() => {
          if (skipNextBlurSaveRef.current) { skipNextBlurSaveRef.current = false; return; }
          if (dirty) save(value);
          setMode('collapsed');
        }}
        placeholder="Internal note for this job…"
        rows={2}
        style={{
          width: '100%',
          background: 'rgba(245,158,11,0.05)',
          color: '#e2e8f0',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 8,
          padding: '6px 8px',
          fontSize: 12,
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11 }}>
        {saving && <span style={{ color: '#94a3b8' }}>Saving…</span>}
        {!saving && dirty && <span style={{ color: '#fbbf24' }}>Press Enter to save</span>}
        {err && <span style={{ color: '#f87171' }}>{err}</span>}
      </div>
    </div>
  );
}

type CrmPickerOption = { crm: any; currentlyPairedWith: { address: string | null; customer: string | null } | null };

function LinkPickerModal({
  job, reportId, options, onClose, onLinked,
}: {
  job: any; // SupabaseReportJob
  reportId: string;
  options: CrmPickerOption[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Direct-id input — accepts any 24-char hex Mongo ObjectId.
  const [directId, setDirectId] = useState('');
  const directIdValid = /^[0-9a-fA-F]{24}$/.test(directId.trim());

  // Sort: unpaired first, then by date.
  const sorted = useMemo(() => {
    const list = [...options].sort((a, b) => {
      const ap = a.currentlyPairedWith ? 1 : 0;
      const bp = b.currentlyPairedWith ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return (a.crm.date || '').localeCompare(b.crm.date || '');
    });
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(({ crm }) => {
      const hay = `${crm.address || ''} ${crm.clientName || ''} ${crm.date || ''} ${crm.totalAmount ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const link = async (crmJobId: string) => {
    setSavingId(crmJobId);
    setErr(null);
    try {
      const res = await fetch(`/api/verify/weekly-reports/${reportId}/jobs/${job.id}/link`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crmJobId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      onLinked();
    } catch (e: any) {
      setErr(String(e?.message || e));
      setSavingId(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(2,6,23,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: '#0d1526', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: 20,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <p className="bp-section-kicker">Link to CRM job</p>
            <h3 style={{ margin: '4px 0 0', color: '#e2e8f0' }}>
              Pair "{job.address || job.customer_name || 'this report job'}" with a CRM job
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Pick from CRM jobs that aren't currently paired in this report. The override is saved to our DB only.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={modalCloseStyle}><FiX size={16} /></button>
        </div>

        {/* Direct-ID link: paste any CRM job ObjectId to link without searching. */}
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: '0 0 4px' }}>
            Link by CRM job ID
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={directId}
              onChange={(e) => setDirectId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && directIdValid) link(directId.trim()); }}
              placeholder="Paste 24-char Mongo ObjectId (e.g. 6a01…f55)"
              style={{
                flex: 1,
                background: 'rgba(15,23,42,0.6)', color: '#e2e8f0',
                border: `1px solid ${directId && !directIdValid ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.10)'}`,
                borderRadius: 8, padding: '8px 10px', fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
            <button
              type="button"
              onClick={() => link(directId.trim())}
              disabled={!directIdValid || !!savingId}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: directIdValid && !savingId ? 'rgba(99,102,241,0.20)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${directIdValid && !savingId ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.08)'}`,
                color: directIdValid && !savingId ? '#c7d2fe' : '#475569',
                cursor: directIdValid && !savingId ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              {savingId === directId.trim() ? 'Linking…' : 'Link by ID'}
            </button>
          </div>
          {directId && !directIdValid && (
            <p style={{ fontSize: 11, color: '#fca5a5', margin: '4px 0 0' }}>
              Must be a 24-character hex ID (Mongo ObjectId). You can copy this from any row's _id in the Tables view.
            </p>
          )}
        </div>

        <p style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: '0 0 4px' }}>
          Or pick from this report's CRM jobs
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by address, customer or date…"
          style={{
            width: '100%',
            background: 'rgba(15,23,42,0.6)', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8,
            padding: '8px 10px', fontSize: 13, marginBottom: 12,
          }}
        />

        {err && (
          <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
              {options.length === 0
                ? 'No CRM jobs in this report’s window.'
                : 'No CRM jobs match your search.'}
            </div>
          )}
          {sorted.map(({ crm: c, currentlyPairedWith }) => {
            const isSaving = savingId === c._id;
            return (
              <button
                key={c._id}
                type="button"
                onClick={() => link(c._id)}
                disabled={!!savingId}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(15,23,42,0.5)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e2e8f0', textAlign: 'left',
                  cursor: savingId ? 'not-allowed' : 'pointer',
                  opacity: savingId && !isSaving ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { if (!savingId) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(99,102,241,0.45)'; }}
                onMouseLeave={(e) => { if (!savingId) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
              >
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {c.address || '(no address)'}
                    {currentlyPairedWith && (
                      <span
                        style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                          padding: '2px 6px', borderRadius: 4,
                          background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
                          border: '1px solid rgba(245,158,11,0.35)',
                        }}
                      >
                        Currently paired
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {c.date || '—'} · {c.clientName || '(no customer)'}
                    {currentlyPairedWith && (
                      <> · with <em style={{ color: '#cbd5e1' }}>{currentlyPairedWith.address || currentlyPairedWith.customer || 'another job'}</em></>
                    )}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: '#a5b4fc', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(c.totalAmount || 0)}
                </span>
                <span style={{ fontSize: 11, color: '#475569' }}>
                  {isSaving ? 'Linking…' : 'Link →'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
