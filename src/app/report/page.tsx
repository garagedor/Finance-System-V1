'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { formatCurrency, formatDisplayDate } from '../utils/jobUtils';
import type { Provider, Technician } from '@/types/job';
import FiltersPanel, { FilterField } from '@/components/FiltersPanel';
import MultiSelect from '@/components/MultiSelect';
import { useFilterRelationships } from '@/hooks/useFilterRelationships';
import DateRangePicker from '@/components/DateRangePicker';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import EmptyState from '@/components/EmptyState';
import { FiAlertTriangle, FiSlash, FiCornerUpLeft, FiUsers, FiChevronLeft, FiChevronRight } from 'react-icons/fi';

type ReportType = 'penalty' | 'dispute' | 'refund' | 'provider';

type PenaltyRow = {
  id: string;
  date: string;
  address: string;
  tech: string;
  location: string;
  provider: string;
  jobProfit: number;
  totalLoss: number;
  amLoss: number;
};

type DisputeRow = {
  id: string;
  disputeId: string;
  jobId?: string;
  status?: string;
  date: string;
  address: string;
  tech: string;
  location: string;
  provider: string;
  totalPaid: number;
  totalAfterFee: number;
  collected?: number;
  grossTip?: number;
  netTip?: number;
  operationalProfit?: number;
  partsLoss?: number;
  disputeType?: 'full' | 'partial';
  parts: number;
  netoTips: number;
  oldBalance: number;
  disputed: number;
  newBalance: number;
  disputedShare: number;
  techShare: number;
  locationManagerShare: number;
  providerShare: number;
  companyShare?: number;
  amPoolShare?: number;
  /** AM's net liability after notionally passing the tech's portion on.
   *  Informational only — settlement still recovers the full amPoolShare. */
  amNetPortion?: number;
  /** True when tech's configured % exceeds the 40% pool — subcontractor case. */
  isSubcontractor?: boolean;
};

type RefundRow = {
  id: string;
  refundId: string;
  date: string;
  address: string;
  tech: string;
  location: string;
  provider: string;
  totalPaid: number;
  totalAfterFee: number;
  collected?: number;
  grossTip?: number;
  netTip?: number;
  operationalProfit?: number;
  partsLoss?: number;
  disputeType?: 'full' | 'partial';
  parts: number;
  netoTips: number;
  oldBalance: number;
  refunded: number;
  reason: string;
  newBalance: number;
  disputedShare: number;
  techShare: number;
  locationManagerShare: number;
  providerShare: number;
  companyShare?: number;
  amPoolShare?: number;
  /** AM's net liability after notionally passing the tech's portion on.
   *  Informational only — settlement still recovers the full amPoolShare. */
  amNetPortion?: number;
  /** True when tech's configured % exceeds the 40% pool — subcontractor case. */
  isSubcontractor?: boolean;
};

type ProviderRow = {
  id: string;
  date: string;
  address: string;
  tech: string;
  location: string;
  provider: string;
  totalPayment: number;
  totalFees: number;
  totalParts: number;
  totalAfterFee: number;
  totalProfit: number;
  providerShare: number;
};

type ReportResponse =
  | { type: 'penalty'; rows: PenaltyRow[]; page?: number; pageSize?: number; total?: number }
  | { type: 'dispute'; rows: DisputeRow[]; page?: number; pageSize?: number; total?: number }
  | { type: 'refund'; rows: RefundRow[]; page?: number; pageSize?: number; total?: number }
  | { type: 'provider'; rows: ProviderRow[]; page?: number; pageSize?: number; total?: number };

type Lookups = {
  techs: Technician[];
  locations: { _id: string }[];
  providers: Provider[];
};

const today = new Date();
const formatDateInput = (d: Date) => d.toISOString().slice(0, 10);
const defaultEnd = formatDateInput(today);
const defaultStart = formatDateInput(new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000));

export default function ReportPage() {
  const { narrowTechs, narrowLocations, narrowProviders } = useFilterRelationships();
  const [reportType, setReportType] = useState<ReportType>('penalty');
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [techs, setTechs] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  // Tracks the filter values currently used for fetching data
  const [activeFilters, setActiveFilters] = useState({
    type: 'penalty' as ReportType,
    techs: [] as string[],
    locations: [] as string[],
    providers: [] as string[],
    startDate: defaultStart,
    endDate: defaultEnd,
    page: 1
  });
  const [isInitialized, setIsInitialized] = useState(false);
  const lastFetchRef = useRef<string | null>(null);
  const lookupsFetchedRef = useRef(false);

  const [rows, setRows] = useState<(PenaltyRow | DisputeRow | RefundRow | ProviderRow)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<any>(null);
  const [totalsCalculated, setTotalsCalculated] = useState(false);
  const [loadingTotals, setLoadingTotals] = useState(false);
  const [lookups, setLookups] = useState<Lookups>({
    techs: [],
    locations: [],
    providers: [],
  });

  useEffect(() => {
    // Restore from sessionStorage on mount
    const saved = sessionStorage.getItem('report-filters');
    if (saved) {
      try {
        const { type: savedType, start, end, techs: savedTechs, location: savedLocation, provider: savedProvider } = JSON.parse(saved);

        const active = {
          type: (savedType as ReportType) || 'penalty',
          techs: [] as string[],
          locations: [] as string[],
          providers: [] as string[],
          startDate: defaultStart,
          endDate: defaultEnd,
          page: 1
        };

        if (savedType) setReportType(savedType);
        if (start) {
          setStartDate(start);
          active.startDate = start;
        }
        if (end) {
          setEndDate(end);
          active.endDate = end;
        }
        if (Array.isArray(savedTechs)) {
          setTechs(savedTechs);
          active.techs = savedTechs;
        }
        // Backward-compat: legacy storage saved single string; new shape is array.
        if (savedLocation) {
          const arr = Array.isArray(savedLocation) ? savedLocation : [savedLocation];
          setLocations(arr);
          active.locations = arr;
        }
        if (savedProvider) {
          const arr = Array.isArray(savedProvider) ? savedProvider : [savedProvider];
          setProviders(arr);
          active.providers = arr;
        }


        setActiveFilters(active);
        setFiltersDirty(false);
      } catch (e) {
        console.error('Failed to parse saved report filters', e);
      }
    }

    // Always mark as initialized after checking storage, 
    // to allow the first fetch to run with either saved or default filters.
    setIsInitialized(true);
  }, []);

  const providerLabel = useMemo(() => {
    const map = new Map<string, string>();
    lookups.providers.forEach((p) => {
      const name = (p as any).name || p._id;
      map.set(p._id, name);
    });
    return map;
  }, [lookups.providers]);

  useEffect(() => {
    if (lookupsFetchedRef.current) return;
    lookupsFetchedRef.current = true;

    const fetchList = async (url: string) => {
      try {
        const res = await fetch(`${url}?page=1&pageSize=500`);
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        if (Array.isArray(json?.rows)) return json.rows;
        if (Array.isArray(json)) return json;
        return [];
      } catch (err) {
        console.error(`Failed to load ${url}`, err);
        return [];
      }
    };

    const fetchLookups = async () => {
      const [techs, locations, providers] = await Promise.all([
        fetchList('/api/techs'),
        fetchList('/api/locations'),
        fetchList('/api/providers'),
      ]);
      setLookups({
        techs,
        locations,
        providers,
      });
    };

    fetchLookups();
  }, []);

  const fetchReport = async () => {
    const params = new URLSearchParams();
    params.set('type', activeFilters.type);
    if (activeFilters.startDate) params.set('startDate', activeFilters.startDate);
    if (activeFilters.endDate) params.set('endDate', activeFilters.endDate);
    activeFilters.techs.forEach(t => params.append('tech', t));
    activeFilters.locations.forEach((l) => params.append('location', l));
    activeFilters.providers.forEach((p) => params.append('provider', p));
    params.set('page', String(activeFilters.page));
    params.set('pageSize', String(pageSize));
    const fetchKey = params.toString();

    // Deduplicate
    if (lastFetchRef.current === fetchKey) return;
    lastFetchRef.current = fetchKey;

    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/report?${fetchKey}`);

      // Prevent race conditions: discard the result if a newer fetch was started
      if (lastFetchRef.current !== fetchKey) return;

      if (!res.ok) {
        setError('Failed to load report');
        return;
      }

      const data = (await res.json()) as ReportResponse;
      setRows((data as any).rows || []);
      setTotal((data as any).total || (data as any).rows?.length || 0);
      setPage((data as any).page || page);
      setFiltersDirty(false);
      setTotalsCalculated(false);
      setTotals(null);
    } catch (err) {
      console.error('Failed to load report', err);
      if (lastFetchRef.current === fetchKey) {
        setError('Failed to load report');
      }
    } finally {
      if (lastFetchRef.current === fetchKey) {
        setLoading(false);
      }
    }
  };

  const calculateTotals = async () => {
    const params = new URLSearchParams();
    params.set('type', activeFilters.type);
    if (activeFilters.startDate) params.set('startDate', activeFilters.startDate);
    if (activeFilters.endDate) params.set('endDate', activeFilters.endDate);
    activeFilters.techs.forEach(t => params.append('tech', t));
    activeFilters.locations.forEach((l) => params.append('location', l));
    activeFilters.providers.forEach((p) => params.append('provider', p));
    params.set('page', '1');
    params.set('pageSize', '1');
    params.set('calculateTotals', 'true');
    const fetchKey = params.toString();

    try {
      setLoadingTotals(true);
      const res = await fetch(`/api/report?${fetchKey}`);
      if (!res.ok) {
        setError('Failed to calculate totals');
        return;
      }
      const data = await res.json();
      setTotals(data.totals || null);
      setTotalsCalculated(true);
    } catch (err) {
      console.error('Failed to calculate totals', err);
      setError('Failed to calculate totals');
    } finally {
      setLoadingTotals(false);
    }
  };

  useEffect(() => {
    if (isInitialized) {
      fetchReport();
    }
  }, [activeFilters, isInitialized]); // Only fetch when active filters change and storage is checked

  const penaltyColumns = [
    { key: 'date', label: 'Date', render: (r: PenaltyRow) => formatDisplayDate(r.date) },
    { key: 'address', label: 'Address' },
    { key: 'tech', label: 'Tech' },
    { key: 'location', label: 'Location' },
    { key: 'provider', label: 'Provider', render: (r: PenaltyRow) => providerLabel.get(r.provider) || r.provider || '-' },
    { key: 'jobProfit', label: 'Job Profit', format: 'currency' },
    { key: 'totalLoss', label: 'Total Loss', format: 'currency' },
    { key: 'amLoss', label: 'AM Loss', format: 'currency' },
  ];

  const disputeColumns = [
    { key: 'date', label: 'Date', render: (r: DisputeRow) => formatDisplayDate(r.date) },
    { key: 'address', label: 'Address' },
    { key: 'tech', label: 'Tech' },
    { key: 'location', label: 'Location' },
    { key: 'status', label: 'Status' },
    { key: 'provider', label: 'Provider', render: (r: DisputeRow) => providerLabel.get(r.provider) || r.provider || '-' },
    { key: 'totalPaid', label: 'Total Paid', format: 'currency' },
    { key: 'totalAfterFee', label: 'Total After Fee', format: 'currency' },
    { key: 'collected', label: 'Collected', format: 'currency' },
    { key: 'operationalProfit', label: 'Op. Profit', format: 'currency' },
    { key: 'parts', label: 'Parts', format: 'currency' },
    { key: 'grossTip', label: 'Gross Tip', format: 'currency' },
    { key: 'netoTips', label: 'Neto Tips', format: 'currency' },
    { key: 'disputed', label: 'Disputed', format: 'currency' },
    { key: 'disputeType', label: 'Type' },
    { key: 'locationManagerShare', label: 'AM Ledger', format: 'currency' },
    {
      key: 'techShare', label: 'Technician Portion', format: 'currency',
      // Informational only — does NOT reduce the AM's recovery. Shows how
      // much of the AM's 40% notionally belongs to the technician based on
      // their configured profitPercent. Appends a "SUB" pill when techPct
      // exceeds the 40% pool (subcontractor — AM eats the gap).
      render: (r: DisputeRow | RefundRow) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.85 }}>
          {formatCurrency(r.techShare)}
          {r.isSubcontractor && (
            <span
              title="Subcontractor — techPct > 40% pool. AM owes tech more than AM recovers."
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.05em',
                padding: '1px 5px',
                background: 'rgba(245,158,11,0.15)',
                color: '#fcd34d',
                border: '1px solid rgba(245,158,11,0.35)',
                borderRadius: 3,
              }}
            >
              SUB
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'amNetPortion', label: 'AM Own Portion', format: 'currency',
      // Informational only — AM Share minus the tech's notional cut.
      render: (r: DisputeRow | RefundRow) => (
        <span style={{ opacity: 0.85 }}>{formatCurrency(r.amNetPortion ?? 0)}</span>
      ),
    },
    { key: 'providerShare', label: 'Provider Charge', format: 'currency' },
    { key: 'companyShare', label: 'Company Charge', format: 'currency' },
    { key: 'partsLoss', label: 'Parts Loss', format: 'currency' },
  ];

  const refundColumns = [
    { key: 'date', label: 'Date', render: (r: RefundRow) => formatDisplayDate(r.date) },
    { key: 'address', label: 'Address' },
    { key: 'tech', label: 'Tech' },
    { key: 'location', label: 'Location' },
    { key: 'provider', label: 'Provider', render: (r: RefundRow) => providerLabel.get(r.provider) || r.provider || '-' },
    { key: 'totalPaid', label: 'Total Paid', format: 'currency' },
    { key: 'totalAfterFee', label: 'Total After Fee', format: 'currency' },
    { key: 'collected', label: 'Collected', format: 'currency' },
    { key: 'operationalProfit', label: 'Op. Profit', format: 'currency' },
    { key: 'parts', label: 'Parts', format: 'currency' },
    { key: 'grossTip', label: 'Gross Tip', format: 'currency' },
    { key: 'netoTips', label: 'Neto Tips', format: 'currency' },
    { key: 'refunded', label: 'Refunded', format: 'currency' },
    { key: 'reason', label: 'Reason' },
    { key: 'disputeType', label: 'Type' },
    { key: 'locationManagerShare', label: 'AM Ledger', format: 'currency' },
    {
      key: 'techShare', label: 'Technician Portion', format: 'currency',
      // Informational only — does NOT reduce the AM's recovery. Shows how
      // much of the AM's 40% notionally belongs to the technician based on
      // their configured profitPercent. Appends a "SUB" pill when techPct
      // exceeds the 40% pool (subcontractor — AM eats the gap).
      render: (r: DisputeRow | RefundRow) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.85 }}>
          {formatCurrency(r.techShare)}
          {r.isSubcontractor && (
            <span
              title="Subcontractor — techPct > 40% pool. AM owes tech more than AM recovers."
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.05em',
                padding: '1px 5px',
                background: 'rgba(245,158,11,0.15)',
                color: '#fcd34d',
                border: '1px solid rgba(245,158,11,0.35)',
                borderRadius: 3,
              }}
            >
              SUB
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'amNetPortion', label: 'AM Own Portion', format: 'currency',
      // Informational only — AM Share minus the tech's notional cut.
      render: (r: DisputeRow | RefundRow) => (
        <span style={{ opacity: 0.85 }}>{formatCurrency(r.amNetPortion ?? 0)}</span>
      ),
    },
    { key: 'providerShare', label: 'Provider Charge', format: 'currency' },
    { key: 'companyShare', label: 'Company Charge', format: 'currency' },
    { key: 'partsLoss', label: 'Parts Loss', format: 'currency' },
  ];

  const providerColumns = [
    { key: 'date', label: 'Date', render: (r: ProviderRow) => formatDisplayDate(r.date) },
    { key: 'address', label: 'Address' },
    { key: 'provider', label: 'Provider', render: (r: ProviderRow) => providerLabel.get(r.provider) || r.provider || '-' },
    { key: 'totalPayment', label: 'Total Payment', format: 'currency' },
    { key: 'totalFees', label: 'Total Fees', format: 'currency' },
    { key: 'totalParts', label: 'Total Parts', format: 'currency' },
    { key: 'totalProfit', label: 'Total Profit', format: 'currency' },
    { key: 'providerShare', label: 'Provider Charge', format: 'currency' },
    { key: 'companyShare', label: 'Company Charge', format: 'currency' },
    { key: 'partsLoss', label: 'Parts Loss', format: 'currency' },
  ];

  const activeColumns =
    activeFilters.type === 'penalty'
      ? penaltyColumns
      : activeFilters.type === 'dispute'
        ? disputeColumns
        : activeFilters.type === 'refund'
          ? refundColumns
          : providerColumns;

  const renderCell = (row: any, col: any) => {
    const value = row[col.key];
    if (col.render) return col.render(row);
    if (col.format === 'currency') return formatCurrency(value);
    return value || '-';
  };

  const handleApply = () => {
    const nextActive = {
      type: reportType,
      techs,
      locations,
      providers,
      startDate,
      endDate,
      page: 1
    };
    setActiveFilters(nextActive);
    // Force fetch for refresh icon
    lastFetchRef.current = null;
    fetchReport();
    setTotalsCalculated(false);
    setTotals(null);

    // Persist to sessionStorage. Storage key names stay 'location'/'provider'
    // for backward-compat with the load logic; the values are now arrays.
    sessionStorage.setItem('report-filters', JSON.stringify({
      type: reportType,
      start: startDate,
      end: endDate,
      techs,
      location: locations,
      provider: providers,
    }));
  };



  const REPORT_TABS: { id: ReportType; label: string; icon: React.ReactNode }[] = [
    { id: 'penalty',  label: 'Penalty',  icon: <FiAlertTriangle size={14} /> },
    { id: 'dispute',  label: 'Dispute',  icon: <FiSlash size={14} /> },
    { id: 'refund',   label: 'Refund',   icon: <FiCornerUpLeft size={14} /> },
    { id: 'provider', label: 'Provider', icon: <FiUsers size={14} /> },
  ];

  const totalPages = total ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  const switchType = (newType: ReportType) => {
    setReportType(newType);
    setRows([]);
    setError(null);
    setTotalsCalculated(false);
    setTotals(null);
    setActiveFilters(prev => ({ ...prev, type: newType, page: 1 }));
    lastFetchRef.current = null;

    sessionStorage.setItem('report-filters', JSON.stringify({
      type: newType,
      start: startDate,
      end: endDate,
      techs,
      location: locations,
      provider: providers,
    }));
  };

  return (
    <main className="report-page">
      {loading && rows.length > 0 && <div className="top-progress" />}

      <div className="content">

        {/* ── Page Header ── */}
        <div className="rpt-header animate-fade-up">
          <div>
            <p className="rpt-kicker">Reports</p>
            <h1 className="rpt-title">Operations Reports</h1>
          </div>
        </div>

        {/* ── Tabbed Type Selector ── */}
        <div className="rpt-tabs animate-fade-up">
          {REPORT_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`rpt-tab ${reportType === tab.id ? 'active' : ''}`}
              onClick={() => switchType(tab.id)}
            >
              <span className="rpt-tab-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Filters ── */}
        <FiltersPanel
          direction="horizontal"
          loading={loading}
          filtersDirty={filtersDirty}
          onApply={handleApply}
          error={error}
        >
          <FilterField label="Dates">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={(start, end) => {
                setStartDate(start);
                setEndDate(end);
                setFiltersDirty(true);
              }}
            />
          </FilterField>
          <FilterField label="Tech">
            <MultiSelect
              options={narrowTechs(lookups.techs.map(t => t._id), locations, providers)}
              selected={techs}
              onChange={(vals) => {
                setTechs(vals);
                setFiltersDirty(true);
              }}
            />
          </FilterField>
          <FilterField label="Location">
            <MultiSelect
              options={narrowLocations(lookups.locations.map((l) => l._id), techs, providers)}
              selected={locations}
              onChange={(v) => { setLocations(v); setFiltersDirty(true); }}
              placeholder="All"
              allLabel="All"
            />
          </FilterField>
          <FilterField label="Provider">
            <MultiSelect
              options={narrowProviders(lookups.providers.map((p) => p._id), locations, techs)
                .map((id) => providerLabel.get(id) || id)}
              selected={providers.map((id) => providerLabel.get(id) || id)}
              onChange={(labels) => {
                const ids = labels.map((l) => {
                  const found = lookups.providers.find((p) => ((p as any).name || p._id) === l);
                  return found ? found._id : l;
                });
                setProviders(ids);
                setFiltersDirty(true);
              }}
              placeholder="All"
              allLabel="All"
            />
          </FilterField>
        </FiltersPanel>

        {/* ── Table card ── */}
        <section className="panel rpt-table-panel animate-fade-up" style={{ animationDelay: '60ms' }}>

          <div className="panel-header rpt-table-header">
            <div className="rpt-table-title">
              <p className="rpt-section-kicker">{REPORT_TABS.find(t => t.id === activeFilters.type)?.label} Report</p>
              <div className="rpt-table-meta">
                <span className="rpt-meta-pill">
                  <strong>{total || rows.length || 0}</strong>
                  <span>rows</span>
                </span>
                {!loading && totalPages > 0 && (
                  <span className="rpt-meta-pages">
                    Page <strong>{activeFilters.page}</strong> of <strong>{totalPages}</strong>
                  </span>
                )}
              </div>
            </div>
            <div className="rpt-table-actions">
              <button
                className={`btn-calculate-totals ${totalsCalculated ? 'calculated' : ''}`}
                onClick={calculateTotals}
                disabled={loading || loadingTotals || filtersDirty || totalsCalculated}
                title={filtersDirty ? 'Apply filters first' : totalsCalculated ? 'Totals already calculated' : 'Calculate totals for all pages'}
              >
                {loadingTotals ? 'Calculating…' : totalsCalculated ? '✓ Calculated' : 'Σ  Calculate Totals'}
              </button>
              <div className="rpt-page-arrows">
                <button
                  className="page-arrow"
                  onClick={() => setActiveFilters(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={activeFilters.page === 1 || loading}
                  aria-label="Previous page"
                >
                  <FiChevronLeft size={14} />
                </button>
                <button
                  className="page-arrow"
                  onClick={() => setActiveFilters(prev => ({ ...prev, page: (total ? Math.min(totalPages, prev.page + 1) : prev.page + 1) }))}
                  disabled={loading || (total ? activeFilters.page >= totalPages : false)}
                  aria-label="Next page"
                >
                  <FiChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="table-wrapper">
            {loading && rows.length === 0 ? (
              /* Skeleton */
              <table>
                <thead>
                  <tr>
                    {activeColumns.map((col) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...Array(8)].map((_, rIdx) => (
                    <tr key={`sk-${rIdx}`}>
                      {activeColumns.map((col) => (
                        <td key={col.key}>
                          <span className="rpt-skel" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <>
                {loading && <LoadingOverlay message="Loading report..." />}
                <table>
                  <thead>
                    <tr>
                      {activeColumns.map((col) => (
                        <th key={col.key}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row: any) => (
                      <tr key={`${row.id || row.disputeId || row.refundId}`}>
                        {activeColumns.map((col) => (
                          <td key={col.key} title={col.key === 'address' ? row.address : undefined}>
                            {renderCell(row, col)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!rows.length && !loading && (
                      <tr className="empty-row">
                        <td colSpan={activeColumns.length}>
                          <EmptyState
                            size="md"
                            title="No matches"
                            message="Try widening your date range or removing filters."
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {totalsCalculated && totals && rows.length > 0 && (
                    <tfoot>
                      <tr className="totals-row">
                        {activeColumns.map((col, idx) => {
                          if (idx === 0) return <td key={`total-${col.key}`} className="totals-label">Totals</td>;
                          if (['address', 'tech', 'location', 'status', 'provider', 'reason'].includes(col.key)) {
                            return <td key={`total-${col.key}`}></td>;
                          }
                          const val = totals[col.key];
                          return (
                            <td key={`total-${col.key}`} className="totals-value">
                              {val !== undefined ? formatCurrency(val) : ''}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </>
            )}
          </div>
        </section>
      </div>

      <style jsx>{`
        .report-page {
          position: relative;
          min-height: 100vh;
          background: #0a0f1c;
          color: #f1f5f9;
        }

        .content {
          width: 100%;
          max-width: none;
          margin: 0;
          padding: 20px 20px 40px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* ── Page header ── */
        .rpt-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .rpt-kicker {
          margin: 0;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.22em;
          color: #818cf8;
        }
        .rpt-title {
          margin: 4px 0 0;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: -0.5px;
          color: #f1f5f9;
        }

        /* ── Tabs ── */
        .rpt-tabs {
          display: inline-flex;
          padding: 4px;
          background: #111827;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          gap: 2px;
          width: fit-content;
        }
        .rpt-tab {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: transparent;
          border: none;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .rpt-tab:hover:not(.active) {
          color: #cbd5e1;
          background: rgba(255, 255, 255, 0.04);
        }
        .rpt-tab.active {
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          color: white;
          box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
        }
        .rpt-tab-icon { display: inline-flex; }

        /* ── Panel ── */
        .panel {
          background: #111827;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 0;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
          overflow: hidden;
        }

        /* ── Table panel header ── */
        .rpt-table-header {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 16px;
          padding: 14px 18px;
          margin: 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          flex-wrap: wrap;
        }
        .rpt-section-kicker {
          margin: 0 0 4px;
          font-size: 14px;
          font-weight: 700;
          color: #f1f5f9;
        }
        .rpt-table-meta {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .rpt-meta-pill {
          display: inline-flex;
          align-items: baseline;
          gap: 5px;
          padding: 3px 10px;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 999px;
          font-size: 11px;
          color: #818cf8;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .rpt-meta-pill strong {
          color: #a5b4fc;
          font-size: 13px;
          font-feature-settings: 'tnum';
        }
        .rpt-meta-pages {
          font-size: 11px;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 500;
        }
        .rpt-meta-pages strong {
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 700;
        }

        .rpt-table-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .rpt-page-arrows {
          display: inline-flex;
          gap: 4px;
        }

        /* ── Skeleton ── */
        .rpt-skel {
          display: inline-block;
          width: 60%;
          height: 12px;
          border-radius: 4px;
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 100%);
          background-size: 200% 100%;
          animation: rptSkel 1.6s linear infinite;
        }
        @keyframes rptSkel {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }

        .filters {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .filters-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: flex-end;
        }

        .filter {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 13px;
        }

        .filter label {
          color: #94a3b8;
          font-weight: 600;
        }

        .btn-calculate-totals {
          background: linear-gradient(135deg, #059669, #10b981);
          color: white;
          box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
          border: none;
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          letter-spacing: 0.01em;
        }
        .btn-calculate-totals:hover:not(:disabled) {
          box-shadow: 0 6px 22px rgba(16, 185, 129, 0.5);
          transform: translateY(-1px);
        }
        .btn-calculate-totals:disabled:not(.calculated) {
          background: rgba(255, 255, 255, 0.05);
          color: #475569;
          box-shadow: none;
          cursor: not-allowed;
        }
        .btn-calculate-totals.calculated,
        .btn-calculate-totals.calculated:disabled {
          background: rgba(16, 185, 129, 0.08);
          color: #34d399;
          box-shadow: none;
          border: 1px solid rgba(16, 185, 129, 0.25);
          opacity: 1;
          cursor: default;
        }

        .actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }

        .error {
          color: #f87171;
          font-weight: 700;
          font-size: 13px;
        }

        .warn {
          color: #f59e0b;
          font-weight: 600;
          font-size: 13px;
        }

        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .panel-header h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          color: #f1f5f9;
        }

        .table-wrapper {
          position: relative;
          width: 100%;
          max-width: 100%;
          max-height: 65vh;
          overflow-x: auto;
          overflow-y: auto;
        }

        .empty-row td {
          padding: 0 !important;
          background: #111827 !important;
          border-bottom: none !important;
        }
        .empty-row:hover td { background: #111827 !important; }

        /* Page arrows */
        .page-arrow {
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: #94a3b8;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .page-arrow:hover:not(:disabled) {
          background: rgba(99, 102, 241, 0.12);
          border-color: rgba(99, 102, 241, 0.35);
          color: #a5b4fc;
        }
        .page-arrow:active:not(:disabled) { transform: scale(0.94); }
        .page-arrow:disabled { opacity: 0.3; cursor: not-allowed; }

        .totals-label {
          font-weight: 700 !important;
          color: #f1f5f9 !important;
          background: #0d1526 !important;
        }
        .totals-value {
          font-weight: 700 !important;
          color: #f1f5f9 !important;
          background: #0d1526 !important;
        }
        .totals-row {
          background: #0d1526;
          border-top: 2px solid rgba(99, 102, 241, 0.4);
        }

        table {
          width: 100%;
          min-width: 1000px;
          border-collapse: collapse;
        }

        th, td {
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding: 9px 8px;
          font-size: 12.5px;
          text-align: center;
          white-space: nowrap;
        }

        th {
          background: #0d1526;
          color: #64748b;
          font-weight: 700;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          position: sticky;
          top: 0;
          z-index: 8;
        }

        td {
          background: #111827;
          color: #cbd5e1;
        }

        tbody tr:hover td {
          background: rgba(99, 102, 241, 0.05);
        }

        tfoot td {
          position: sticky;
          bottom: 0;
          z-index: 10;
          background: #0d1526 !important;
          border-top: 2px solid rgba(99, 102, 241, 0.4) !important;
          color: #f1f5f9;
        }

        .muted {
          color: #64748b;
        }

        .small {
          font-size: 12px;
        }

        @media (max-width: 900px) {
          .content { padding: 16px 12px 32px; }
          .rpt-tabs { width: 100%; overflow-x: auto; }
          .rpt-tab { flex-shrink: 0; }
          .rpt-table-header { flex-direction: column; align-items: flex-start !important; }
          .rpt-table-actions { width: 100%; justify-content: space-between; }
        }
      `}</style>
    </main>
  );
}
