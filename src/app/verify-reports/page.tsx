'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FiCheck, FiX, FiAlertTriangle, FiArrowLeft, FiChevronRight, FiCheckCircle, FiHelpCircle, FiUsers, FiCalendar, FiEdit2 } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import EmptyState from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { SummaryStrip, AlertCard } from '@/components/ui';
import { formatCurrency, formatDisplayDate } from '../utils/jobUtils';
import '../balance-report/styles.css';
import dynamic from 'next/dynamic';
import { clientHasPermission } from '@/lib/permissions-client';
const EditJobModal = dynamic(() => import('./EditJobModal'), { ssr: false });
const LinkPickerModal = dynamic(() => import('./LinkPickerModal'), { ssr: false });

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

  // Verify is admin-only today, and stays admin-only — but it says so in the
  // RBAC vocabulary rather than by job title, so the page, the navigation and
  // the API all gate on the same string. Admin holds this through the seeded
  // Admin role's ALL_PERMISSIONS; no other seeded role holds it.
  //
  // The real boundary is the API, which re-checks server-side on every call.
  if (!clientHasPermission(user, 'crm:verify_reports:view')) {
    return (
      <div className="flex h-[60vh] items-center justify-center px-6">
        <EmptyState
          size="lg"
          icon={<svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="var(--ds-crit)" strokeWidth="1.5" />
            <line x1="10" y1="6" x2="10" y2="10.5" stroke="var(--ds-crit)" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="10" cy="13" r="0.75" fill="var(--ds-crit)" />
          </svg>}
          title="Access Denied"
          message="You do not have permission to verify weekly reports."
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
  /* Inbox orientation, derived from the reports already fetched. No request is
     added and no figure is invented: each one counts a flag the API already
     returns per report. */
  const visibleReports = useMemo(
    () => (reports || []).filter((r) => !techFilter || r.techName === techFilter),
    [reports, techFilter]
  );

  const inboxStats = useMemo(() => ({
    awaiting: visibleReports.filter((r) => r.status === 'Submitted').length,
    // Locked treatment: an identity the system could not resolve is a warning,
    // because the comparison still runs and may be comparing the wrong person.
    unmatched: visibleReports.filter((r) => !r.techMatched || !r.areaMatched).length,
    resubmitted: visibleReports.filter((r) => r.resubmitted).length,
  }), [visibleReports]);

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
                <strong>317 Weekly Balance</strong>
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
          <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'var(--ds-crit-line)' }}>
            <p style={{ fontSize: 12, color: 'var(--ds-ink-2)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
              Couldn't load reports
            </p>
            <pre style={{ color: 'var(--ds-crit-text)', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
            {error.toLowerCase().includes('supabase not configured') && (
              <p style={{ fontSize: 12, color: 'var(--ds-ink)', marginTop: 10 }}>
                The 317 Weekly Balance backend isn't connected yet. Add <code>SUPABASE_URL</code> and{' '}
                <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code>, then restart the dev server.
              </p>
            )}
          </div>
        )}

        {/* ── Reconciliation state, before any of the detail ──
             Derived from the reports already loaded. Unmatched identity takes
             the warning family, which is the locked treatment for a tech or
             area the system could not resolve — it is the one condition here
             that silently produces a wrong comparison. */}
        {visibleReports.length > 0 && (
          <>
            <SummaryStrip
              items={[
                {
                  label: 'Reports in view',
                  value: String(visibleReports.length),
                  sub: techFilter ? `${techFilter} — every week` : statusFilter === 'All' ? 'every status' : `${statusFilter.toLowerCase()}`,
                },
                {
                  label: 'Awaiting review',
                  value: String(inboxStats.awaiting),
                  sub: inboxStats.awaiting === 0 ? 'nothing queued' : 'submitted, not yet verified',
                },
                {
                  label: 'Unmatched identity',
                  value: String(inboxStats.unmatched),
                  sub: inboxStats.unmatched === 0 ? 'all resolved' : 'tech or area not resolved',
                },
                {
                  label: 'Resubmitted',
                  value: String(inboxStats.resubmitted),
                  sub: inboxStats.resubmitted === 0 ? 'none returned' : 'sent back and corrected',
                },
              ]}
            />
            {inboxStats.unmatched > 0 && (
              <AlertCard
                tone="warn"
                title={`${inboxStats.unmatched} report${inboxStats.unmatched === 1 ? '' : 's'} with an unresolved tech or area`}
                description="The comparison still runs, but a name the system could not resolve means it may be comparing against the wrong person or the wrong area. Fix the mapping before approving."
              />
            )}
          </>
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
          <span style={{ fontSize: 12, color: 'var(--ds-ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Tech History
          </span>
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            style={{
              background: 'var(--ds-surface-2)',
              color: 'var(--ds-ink)',
              border: '1px solid var(--ds-line-strong)',
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
                background: 'var(--ds-info-wash)',
                border: '1px solid var(--ds-info-line)',
                color: 'var(--ds-info-text)', fontSize: 12, fontWeight: 500,
              }}
            >
              Viewing all weeks for <strong>{techFilter}</strong>
              <button
                onClick={() => setTechFilter('')}
                style={{ background: 'transparent', border: 'none', color: 'var(--ds-info-text)', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
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
              <span style={{ color: 'var(--ds-ink-2)', fontWeight: 400, fontSize: 13 }}>
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
                  style={{ marginLeft: 12, background: 'transparent', border: 'none', color: 'var(--ds-info-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}
                >
                  Clear selection
                </button>
              )}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <OverviewStat label="Total Sales"              value={formatCurrency(overviewTotals.sales)}      />
              <OverviewStat label="Total Balance"            value={formatCurrency(overviewTotals.balance)}     />
              <OverviewStat label="Tips"                     value={formatCurrency(overviewTotals.tips)}       />
              <OverviewStat label="Commission (Tech Payout)" value={formatCurrency(overviewTotals.commission)} accent="var(--ds-info-text)" />
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
                    style={selectedReportIds.has(r.id) ? { background: 'var(--ds-neutral-wash)' } : undefined}
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
                          style={{ accentColor: 'var(--ds-info)', cursor: 'pointer' }}
                        />
                      </td>
                    )}
                    <td onClick={(e) => { e.stopPropagation(); if (r.techName) setTechFilter(r.techName); }}
                        title={r.techName ? `Show all weeks for ${r.techName}` : undefined}
                        style={{ cursor: r.techName ? 'pointer' : undefined, color: techFilter === r.techName ? 'var(--ds-info-text)' : undefined, fontWeight: techFilter === r.techName ? 600 : undefined }}>
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
                            fontWeight: 600, background: 'var(--ds-warn-soft)', color: 'var(--ds-warn-text)',
                            border: '1px solid var(--ds-warn-line)', whiteSpace: 'nowrap',
                          }}
                        >
                          resubmitted
                        </span>
                      )}
                    </td>
                    <td>{r.submittedAt ? formatDisplayDate(r.submittedAt.slice(0, 10)) : '—'}</td>
                    <td>{r.supabaseJobCount}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(r.supabaseTotalSales)}</td>
                    <td style={{ fontWeight: (r.supabaseBalance ?? 0) !== 0 ? 600 : undefined }}>
                      {formatCurrency(r.supabaseBalance || 0)}
                    </td>
                    <td>{formatCurrency(r.supabaseTips || 0)}</td>
                    <td style={{ color: 'var(--ds-ink)', fontWeight: 600 }}>{formatCurrency(r.supabaseCommission || 0)}</td>
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
          <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'var(--ds-crit-line)' }}>
            <pre style={{ color: 'var(--ds-crit-text)', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
          </div>
        )}

        {loading && !data && (
          <div className="panel" style={{ padding: 24, position: 'relative', minHeight: 120 }}>
            <LoadingOverlay message="Comparing report against CRM..." />
          </div>
        )}

        {data && (
          <>
            {/* ── Reconciliation state, before anything else ──
                 The locked hierarchy: matched is ok, mismatched is a warning,
                 and a job present on only one side cannot be reconciled at all,
                 so it is critical. These four numbers were already computed by
                 the API and were previously readable only as a single crowded
                 pill further down the page. */}
            <SummaryStrip
              items={[
                {
                  label: 'Matched',
                  value: String(data.summary.matched),
                  sub: `of ${Math.max(data.summary.supabaseJobCount, data.summary.crmJobCount)} jobs`,
                },
                {
                  label: 'Mismatched',
                  value: String(data.summary.mismatched),
                  sub: data.summary.mismatched === 0 ? 'figures agree' : 'figures disagree',
                },
                {
                  label: 'In CRM only',
                  value: String(data.summary.missingInCrm),
                  sub: data.summary.missingInCrm === 0 ? 'none' : 'absent from the report',
                },
                {
                  label: 'In report only',
                  value: String(data.summary.missingInReport),
                  sub: data.summary.missingInReport === 0 ? 'none' : 'absent from the CRM',
                },
              ]}
            />

            {(() => {
              const unreconciled = data.summary.missingInCrm + data.summary.missingInReport;
              const identityUnresolved = !data.report.techMatched || !data.report.areaMatched;
              if (unreconciled > 0) {
                return (
                  <AlertCard
                    tone="crit"
                    title={`${unreconciled} job${unreconciled === 1 ? '' : 's'} cannot be reconciled`}
                    description="A job on one side with nothing to compare it against. Link it, or establish that it should not be there, before approving — the totals below cannot be right while it is unresolved."
                  />
                );
              }
              if (data.summary.mismatched > 0) {
                return (
                  <AlertCard
                    tone="warn"
                    title={`${data.summary.mismatched} job${data.summary.mismatched === 1 ? '' : 's'} with figures that disagree`}
                    description="Every job is paired; some amounts differ beyond tolerance. The rows are highlighted below."
                  />
                );
              }
              if (identityUnresolved) {
                return (
                  <AlertCard
                    tone="warn"
                    title="This report's tech or area could not be resolved"
                    description="Everything reconciles, but an unresolved name means it may have been compared against the wrong person or area."
                  />
                );
              }
              return (
                <AlertCard
                  tone="ok"
                  title="Fully reconciled"
                  description="Every job is paired and every figure agrees within tolerance."
                />
              );
            })()}

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
      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--ds-ink-2)', letterSpacing: 0.6, marginBottom: 10 }}>
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
        ? <FiCheckCircle color="var(--ds-ok)" />
        : <FiAlertTriangle color="var(--ds-warn)" />}
      <span style={{ color: ok ? 'var(--ds-ink)' : 'var(--ds-warn-text)' }}>{ok ? ok_label : bad_label}</span>
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

  const colorForDiff = (d: number) => (Math.abs(d) > 1 ? 'var(--ds-warn-text)' : 'var(--ds-ok-text)');

  return (
    <div className="panel bp-table-panel animate-fade-up" style={{ marginBottom: 12 }}>
      <div className="panel-header">
        <div>
          <p className="bp-section-kicker">Summary</p>
          <h3>Totals comparison</h3>
        </div>
        <span className="bp-pill" style={{ background: summary.mismatched + summary.missingInCrm + summary.missingInReport > 0 ? 'var(--ds-warn-soft)' : 'var(--ds-ok-wash)' }}>
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
                <td>{Math.abs(r.diff) > 1 ? <FiAlertTriangle color="var(--ds-warn)" /> : <FiCheck color="var(--ds-ok)" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {crmExtras.length > 0 && (
          <div style={{ padding: '8px 14px 14px', borderTop: '1px solid var(--ds-line)' }}>
            <p style={{ fontSize: 11, color: 'var(--ds-ink-2)', marginBottom: 6 }}>
              CRM has these payment fields that the 317 Weekly Balance app doesn't track (informational only):
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {crmExtras.map((e) => (
                <span key={e.label} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'var(--ds-surface-3)', border: '1px solid var(--ds-line)', color: 'var(--ds-ink)' }}>
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
      case 'match':              return <span style={pillStyle(PILL_OK)}><FiCheck /> match</span>;
      case 'mismatch':           return <span style={pillStyle(PILL_WARN)}><FiAlertTriangle /> mismatch</span>;
      case 'missing-in-crm':     return <span style={pillStyle(PILL_CRIT)}><FiX /> CRM-only missing</span>;
      case 'missing-in-report':  return <span style={pillStyle(PILL_CRIT)}><FiX /> Report-only missing</span>;
    }
  })();

  return (
    <tr>
      <td style={{ textAlign: 'left' }}>{statusBadge}</td>
      <td style={{ textAlign: 'left' }}>{date ? formatDisplayDate(date) : '—'}</td>
      <td style={{ textAlign: 'left', overflow: 'hidden' }}>
        <div title={address || '—'} style={truncStyle}>{address || '—'}</div>
        {customer && (
          <div title={customer} style={{ ...truncStyle, fontSize: 11, color: 'var(--ds-ink-2)', marginTop: 2 }}>
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
              <span style={{ color: 'var(--ds-warn-text)' }}>
                Payment method: reported <strong>{pair.methodDiff.supabase || '—'}</strong> · CRM <strong>{pair.methodDiff.crm || '—'}</strong>
              </span>
            )}
            {pair.diffs.filter((d) => d.exceedsTolerance).map((d) => (
              <span key={d.field} style={{ color: 'var(--ds-warn-text)' }}>
                {d.label}: reported {formatCurrency(d.supabase)} · CRM {formatCurrency(d.crm)} · {d.diff > 0 ? '+' : ''}{formatCurrency(d.diff)}
              </span>
            ))}
          </div>
        )}
        {pair.status === 'missing-in-crm' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--ds-ink-2)' }}>Tech reported, CRM has no record</span>
            <button
              type="button"
              onClick={onStartLink}
              style={{
                fontSize: 11, fontWeight: 600,
                padding: '3px 8px', borderRadius: 6,
                background: 'var(--ds-info-wash)',
                border: '1px solid var(--ds-info-line)',
                color: 'var(--ds-info-text)', cursor: 'pointer',
              }}
            >
              Link to CRM job →
            </button>
          </span>
        )}
        {pair.status === 'missing-in-report' && <span style={{ fontSize: 12, color: 'var(--ds-ink-2)' }}>CRM has it, tech didn't report</span>}
        {pair.status === 'match' && <span style={{ fontSize: 12, color: 'var(--ds-ok-text)' }}>All within $1 tolerance</span>}
        {pair.manualLink && pair.supabaseJob && (
          <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                padding: '2px 6px', borderRadius: 4,
                background: 'var(--ds-info-wash)', color: 'var(--ds-info-text)',
                border: '1px solid var(--ds-info-line)',
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
                color: 'var(--ds-ink-2)', fontSize: 11, fontWeight: 600,
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
          if (!noteOwner) return <span style={{ fontSize: 11, color: 'var(--ds-ink-2)' }}>—</span>;
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
              background: 'transparent', border: '1px solid var(--ds-line)',
              color: 'var(--ds-ink-2)', padding: 6, borderRadius: 6, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ds-ink)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-line-strong)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ds-ink-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-line)'; }}
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
    return <span style={methodPillStyle(METHOD_REPORTED)}>{sup}</span>;
  }
  if (sup && crm) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
        <span style={methodPillStyle(METHOD_REPORTED)}>{sup}</span>
        <span style={{ ...methodPillStyle(METHOD_CRM), opacity: 0.85 }}>CRM: {crm}</span>
      </div>
    );
  }
  if (sup) return <span style={methodPillStyle(METHOD_REPORTED)}>{sup}</span>;
  if (crm) return <span style={methodPillStyle(METHOD_CRM)}>{crm}</span>;
  return <span style={{ color: 'var(--ds-ink-2)', fontSize: 12 }}>—</span>;
}

/* Payment-method source labels. Which system a value came from is category
   information, not status, so both tiers are neutral; the CRM pill is already
   prefixed "CRM:" and the reported value is the filled one. */
const METHOD_REPORTED: PillTier = { text: 'var(--ds-ink)',          wash: 'var(--ds-neutral-wash)', line: 'var(--ds-neutral-line)' };
const METHOD_CRM:      PillTier = { text: 'var(--ds-neutral-text)', wash: 'transparent',            line: 'var(--ds-neutral-line)' };

function methodPillStyle(tier: PillTier): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 999,
    fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
    background: tier.wash, color: tier.text, border: `1px solid ${tier.line}`,
  };
}

// ─── EDIT JOB MODAL ─────────────────────────────────────────────────────────


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
        <FiHelpCircle color="var(--ds-ink-2)" />
        <span style={{ fontSize: 12, color: 'var(--ds-ink-2)' }}>
          {error
            ? <span style={{ color: 'var(--ds-crit-text)' }}>{error}</span>
            : <>Current status: <strong style={{ color: 'var(--ds-ink)' }}>{currentStatus}</strong></>}
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
      background: ok ? 'var(--ds-ok-wash)' : 'var(--ds-warn-soft)',
      color: ok ? 'var(--ds-ok-text)' : 'var(--ds-warn-text)',
      border: `1px solid ${ok ? 'var(--ds-ok-line)' : 'var(--ds-warn-line)'}`,
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
        background: active ? 'var(--ds-info-wash)' : 'var(--ds-surface-3)',
        border: `1px solid ${active ? 'var(--ds-info-line)' : 'var(--ds-line)'}`,
        color: active ? 'var(--ds-info-text)' : 'var(--ds-ink)',
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

/* Reconciliation severity. match = both sides agree within TOLERANCE_USD and
   on payment method; mismatch = both exist but disagree; missing = one side is
   absent so the comparison cannot be completed. warn uses -soft rather than
   -wash because text sits on it (-wash measures 4.47 in light). */
type PillTier = { text: string; wash: string; line: string };
const PILL_OK:   PillTier = { text: 'var(--ds-ok-text)',   wash: 'var(--ds-ok-wash)',   line: 'var(--ds-ok-line)' };
const PILL_WARN: PillTier = { text: 'var(--ds-warn-text)', wash: 'var(--ds-warn-soft)', line: 'var(--ds-warn-line)' };
const PILL_CRIT: PillTier = { text: 'var(--ds-crit-text)', wash: 'var(--ds-crit-wash)', line: 'var(--ds-crit-line)' };

function pillStyle(tier: PillTier): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999,
    fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    background: tier.wash, color: tier.text, border: `1px solid ${tier.line}`,
  };
}

function OverviewStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--ds-surface-2)', border: '1px solid var(--ds-line)', borderRadius: 12, padding: '12px 14px' }}>
      <p style={{ fontSize: 11, color: 'var(--ds-ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: accent || 'var(--ds-ink)', marginTop: 4, marginBottom: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
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
    <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'var(--ds-line)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p className="bp-section-kicker" style={{ margin: 0 }}>Admin Note · CRM only</p>
          <h3 style={{ marginTop: 4, marginBottom: 0, fontSize: 15 }}>Notes about this report</h3>
        </div>
        {savedAt && (
          <span style={{ fontSize: 11, color: 'var(--ds-ink-2)' }}>
            Last saved {formatDisplayDate(savedAt.slice(0, 10))}{savedBy ? ` · ${savedBy}` : ''}
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Internal notes — not visible to the tech in the Weekly Balance app."
        rows={3}
        style={{
          width: '100%',
          background: 'var(--ds-surface-2)',
          color: 'var(--ds-ink)',
          border: '1px solid var(--ds-line-strong)',
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
        {err && <span style={{ fontSize: 12, color: 'var(--ds-crit-text)' }}>{err}</span>}
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
            color: 'var(--ds-info-text)', fontSize: 12, fontWeight: 600,
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
            background: 'var(--ds-surface-2)',
            border: '1px solid var(--ds-line)',
            borderRadius: 8, padding: '6px 8px',
            fontSize: 12, color: 'var(--ds-ink)',
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
            background: 'var(--ds-surface-2)',
            border: '1px solid var(--ds-line)',
            color: 'var(--ds-info-text)', fontSize: 11, fontWeight: 600,
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
      <span style={{ fontSize: 10, color: 'var(--ds-ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
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
          background: 'var(--ds-surface-2)',
          color: 'var(--ds-ink)',
          border: '1px solid var(--ds-line-strong)',
          borderRadius: 8,
          padding: '6px 8px',
          fontSize: 12,
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11 }}>
        {saving && <span style={{ color: 'var(--ds-ink-2)' }}>Saving…</span>}
        {!saving && dirty && <span style={{ color: 'var(--ds-ink-2)' }}>Press Enter to save</span>}
        {err && <span style={{ color: 'var(--ds-crit-text)' }}>{err}</span>}
      </div>
    </div>
  );
}

