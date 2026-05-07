'use client';

import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { formatCurrency, formatDisplayDate } from '../utils/jobUtils';
import { Technician, Location } from '@/types/job';
import './styles.css';
import FiltersPanel, { FilterField } from '@/components/FiltersPanel';
import DateRangePicker from '@/components/DateRangePicker';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import EmptyState from '@/components/EmptyState';
import { useClickOutside } from '@/hooks/useClickOutside';
import { FiBriefcase, FiTrendingUp, FiDollarSign, FiCheckCircle, FiPercent, FiAlertCircle, FiChevronDown } from 'react-icons/fi';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';

type BalanceRow = {
  id: string;
  date: string;
  address: string;
  tech: string;
  location: string;
  status: string;
  paidSum: number;
  techParts: number;
  companyParts: number;
  lmParts: number;
  lmCash: number;
  lmCheck: number;
  paymentFee: number;
  totalProfit: number;
  shareAmount: number;
  techPaidCash: number;
  totalPaidCard: number;
  totalPaidCompanyCheck: number;
  totalPaidFinance: number;
  totalPaidCompanyCash: number;
  tipsTotal: number;
  balance: number;
  techOwedToLm: number;
  lmOwedFromTech: number;
  lmOwesCompany: number;
  approvals: Array<{ name: string; role: string }>;
  paymentMethod: string;
};

type StatusRow = { key: string; count: number };

type ApiResponse = {
  rows: BalanceRow[];
  totals: {
    assigned: number;
    profit: number;
    avgTicket: number;
    avgClosedJob: number;
  };
  statusStats: StatusRow[];
  locationVsTech: { locationShare: number; techShare: number; diff: number };
  appliedPct: number;
  activeTechs: string[];
};

const colorForIndex = (idx: number) => `hsl(${(idx * 137.508) % 360}deg 70% 55%)`;
const formatDateInput = (d: Date) => d.toISOString().slice(0, 10);
const defaultEndDate = formatDateInput(new Date());
const defaultStartDate = formatDateInput(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
type PieDatum = { name: string; value: number; percent: number; color: string };

// ─── Closed Jobs Breakdown — column visibility (display-only) ────────────────
// Hiding columns affects the rendered table rows + totals row only.
// The closedTotals reducer keeps summing every field across every closed row,
// so any visible total cell still reflects the full underlying data.
type ColKey =
  | 'date' | 'address' | 'paymethod' | 'approvals'
  | 'job-total' | 'tech-parts' | 'company-parts' | 'payment-fee' | 'total-profit'
  | 'lm-parts' | 'lm-cash' | 'lm-check'
  | 'tech-payout' | 'cash'
  | 'co-tech' | 'tech-lm' | 'lm-co' | 'tips' | 'net-tips';

type PresetId = 'admin' | 'tech' | 'lm' | 'custom';

type ClosedTotalsShape = {
  paidSum: number;
  techParts: number;
  companyParts: number;
  lmParts: number;
  lmCash: number;
  lmCheck: number;
  paymentFee: number;
  totalProfit: number;
  shareAmount: number;
  techPaidCash: number;
  balance: number;
  tipsTotal: number;
  techOwedToLm: number;
  lmOwesCompany: number;
};

type ColDef = {
  key: ColKey;
  label: string;
  renderBody: (job: BalanceRow) => ReactNode;
  renderTotal: ((t: ClosedTotalsShape) => ReactNode) | null;
};

type ColGroupId = 'meta' | 'cost' | 'lm' | 'payout' | 'settle';
type ColGroup = { id: ColGroupId; label: string; cssClass: string; cols: ColDef[] };

const renderApprovalsCell = (job: BalanceRow): ReactNode => {
  if (!job.approvals.length) return null;
  const names = job.approvals.map((a) => a.name).join(', ');
  const hasAdmin = job.approvals.some((a) => a.role === 'admin');
  const hasOffice = job.approvals.some((a) => a.role === 'office');
  const style = hasAdmin
    ? { background: 'rgba(16,185,129,0.15)', color: '#34d399' }
    : hasOffice
      ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
      : { background: 'rgba(255,255,255,0.08)', color: '#94a3b8' };
  return (
    <span title={names} style={{ ...style, padding: '2px 6px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-block' }}>
      {names}
    </span>
  );
};

const COLUMN_GROUPS: ColGroup[] = [
  {
    id: 'meta', label: 'Job Info', cssClass: 'bp-group-meta',
    cols: [
      { key: 'date',      label: 'Date',       renderBody: (j) => <td key="date">{formatDisplayDate(j.date)}</td>,                                  renderTotal: null },
      { key: 'address',   label: 'Address',    renderBody: (j) => <td key="address" className="truncate" title={j.address}>{j.address || '-'}</td>, renderTotal: null },
      { key: 'paymethod', label: 'Pay Method', renderBody: (j) => <td key="paymethod">{j.paymentMethod}</td>,                                       renderTotal: null },
      { key: 'approvals', label: 'Approvals',  renderBody: (j) => <td key="approvals">{renderApprovalsCell(j)}</td>,                                renderTotal: null },
    ],
  },
  {
    id: 'cost', label: 'Costs & Profit', cssClass: 'bp-group-cost',
    cols: [
      { key: 'job-total',     label: 'Job Total',     renderBody: (j) => <td key="job-total">{formatCurrency(j.paidSum)}</td>,         renderTotal: (t) => <td key="job-total">{formatCurrency(t.paidSum)}</td> },
      { key: 'tech-parts',    label: 'Tech Parts',    renderBody: (j) => <td key="tech-parts">{formatCurrency(j.techParts)}</td>,      renderTotal: (t) => <td key="tech-parts">{formatCurrency(t.techParts)}</td> },
      { key: 'company-parts', label: 'Company Parts', renderBody: (j) => <td key="company-parts">{formatCurrency(j.companyParts)}</td>, renderTotal: (t) => <td key="company-parts">{formatCurrency(t.companyParts)}</td> },
      { key: 'payment-fee',   label: 'Payment Fee',   renderBody: (j) => <td key="payment-fee">{formatCurrency(j.paymentFee)}</td>,    renderTotal: (t) => <td key="payment-fee">{formatCurrency(t.paymentFee)}</td> },
      { key: 'total-profit',  label: 'Total Profit',  renderBody: (j) => <td key="total-profit">{formatCurrency(j.totalProfit)}</td>,  renderTotal: (t) => <td key="total-profit">{formatCurrency(t.totalProfit)}</td> },
    ],
  },
  {
    id: 'lm', label: 'LM', cssClass: 'bp-group-meta',
    cols: [
      { key: 'lm-parts', label: 'LM Parts', renderBody: (j) => <td key="lm-parts">{formatCurrency(j.lmParts)}</td>, renderTotal: (t) => <td key="lm-parts">{formatCurrency(t.lmParts)}</td> },
      { key: 'lm-cash',  label: 'LM Cash',  renderBody: (j) => <td key="lm-cash">{formatCurrency(j.lmCash)}</td>,   renderTotal: (t) => <td key="lm-cash">{formatCurrency(t.lmCash)}</td> },
      { key: 'lm-check', label: 'LM Check', renderBody: (j) => <td key="lm-check">{formatCurrency(j.lmCheck)}</td>, renderTotal: (t) => <td key="lm-check">{formatCurrency(t.lmCheck)}</td> },
    ],
  },
  {
    id: 'payout', label: 'Tech Payout', cssClass: 'bp-group-payout',
    cols: [
      { key: 'tech-payout', label: 'Tech Payout', renderBody: (j) => <td key="tech-payout">{formatCurrency(j.shareAmount)}</td>, renderTotal: (t) => <td key="tech-payout">{formatCurrency(t.shareAmount)}</td> },
      { key: 'cash',        label: 'Cash',        renderBody: (j) => <td key="cash">{formatCurrency(j.techPaidCash)}</td>,       renderTotal: (t) => <td key="cash">{formatCurrency(t.techPaidCash)}</td> },
    ],
  },
  {
    id: 'settle', label: 'Settlements', cssClass: 'bp-group-balance',
    cols: [
      {
        key: 'co-tech', label: 'Co.↔Tech',
        renderBody: (j) => <td key="co-tech" style={{ color: j.balance * -1 < 0 ? '#f87171' : j.balance * -1 > 0 ? '#34d399' : undefined, fontWeight: j.balance !== 0 ? 600 : undefined }}>{formatCurrency(j.balance * -1)}</td>,
        renderTotal: (t) => <td key="co-tech" style={{ color: t.balance * -1 < 0 ? '#f87171' : t.balance * -1 > 0 ? '#34d399' : undefined }}>{formatCurrency(t.balance * -1)}</td>,
      },
      {
        key: 'tech-lm', label: 'Tech→LM',
        renderBody: (j) => <td key="tech-lm" style={{ color: j.techOwedToLm > 0 ? '#fbbf24' : undefined, fontWeight: j.techOwedToLm > 0 ? 600 : undefined }}>{formatCurrency(j.techOwedToLm)}</td>,
        renderTotal: (t) => <td key="tech-lm" style={{ color: t.techOwedToLm > 0 ? '#fbbf24' : undefined }}>{formatCurrency(t.techOwedToLm)}</td>,
      },
      {
        key: 'lm-co', label: 'LM→Co.',
        renderBody: (j) => <td key="lm-co" style={{ color: j.lmOwesCompany > 0 ? '#22d3ee' : undefined, fontWeight: j.lmOwesCompany > 0 ? 600 : undefined }}>{formatCurrency(j.lmOwesCompany)}</td>,
        renderTotal: (t) => <td key="lm-co" style={{ color: t.lmOwesCompany > 0 ? '#22d3ee' : undefined }}>{formatCurrency(t.lmOwesCompany)}</td>,
      },
      {
        key: 'tips', label: 'Tips',
        renderBody: (j) => <td key="tips">{formatCurrency(j.tipsTotal)}</td>,
        renderTotal: (t) => <td key="tips">{formatCurrency(t.tipsTotal)}</td>,
      },
      {
        key: 'net-tips', label: 'Net + Tips',
        renderBody: (j) => <td key="net-tips" style={{ color: (j.balance + j.tipsTotal) * -1 < 0 ? '#f87171' : (j.balance + j.tipsTotal) * -1 > 0 ? '#34d399' : undefined, fontWeight: (j.balance + j.tipsTotal) !== 0 ? 600 : undefined }}>{formatCurrency((j.balance + j.tipsTotal) * -1)}</td>,
        renderTotal: (t) => <td key="net-tips" style={{ color: (t.balance + t.tipsTotal) * -1 < 0 ? '#f87171' : (t.balance + t.tipsTotal) * -1 > 0 ? '#34d399' : undefined }}>{formatCurrency((t.balance + t.tipsTotal) * -1)}</td>,
      },
    ],
  },
];

const ALL_COL_KEYS: ColKey[] = COLUMN_GROUPS.flatMap((g) => g.cols.map((c) => c.key));

const PRESET_VISIBLE: Record<Exclude<PresetId, 'custom'>, ColKey[]> = {
  admin: ALL_COL_KEYS,
  tech:  ['date', 'address', 'paymethod', 'job-total', 'tech-parts', 'lm-parts', 'tech-payout', 'cash', 'co-tech', 'tech-lm', 'tips', 'net-tips'],
  lm:    ['date', 'address', 'job-total', 'lm-parts', 'lm-cash', 'lm-check', 'tech-lm', 'lm-co'],
};

const PRESET_LABELS: Record<PresetId, string> = {
  admin:  'Full Admin View',
  tech:   'Technician View',
  lm:     'LM View',
  custom: 'Custom',
};

const COLUMNS_STORAGE_KEY = 'balance-report-column-preset-v1';

const visibilityFromPreset = (id: Exclude<PresetId, 'custom'>): Record<ColKey, boolean> => {
  const visibleSet = new Set(PRESET_VISIBLE[id]);
  return Object.fromEntries(ALL_COL_KEYS.map((k) => [k, visibleSet.has(k)])) as Record<ColKey, boolean>;
};

const matchesPreset = (vis: Record<ColKey, boolean>, id: Exclude<PresetId, 'custom'>): boolean => {
  const target = visibilityFromPreset(id);
  return ALL_COL_KEYS.every((k) => target[k] === vis[k]);
};

const detectPreset = (vis: Record<ColKey, boolean>): PresetId => {
  return (['admin', 'tech', 'lm'] as const).find((p) => matchesPreset(vis, p)) ?? 'custom';
};

export default function BalanceReportPage() {
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [lookups, setLookups] = useState<{ techs: Technician[]; locations: Location[] }>({
    techs: [],
    locations: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [techFilter, setTechFilter] = useState('');
  const [appliedStart, setAppliedStart] = useState(defaultStartDate);
  const [appliedEnd, setAppliedEnd] = useState(defaultEndDate);
  const [appliedTech, setAppliedTech] = useState('');
  const [mode, setMode] = useState<'tech' | 'location'>('tech');
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [totals, setTotals] = useState<ApiResponse['totals']>({
    assigned: 0,
    profit: 0,
    avgTicket: 0,
    avgClosedJob: 0,
  });
  const [statusStats, setStatusStats] = useState<StatusRow[]>([]);
  const [locationVsTech, setLocationVsTech] = useState<ApiResponse['locationVsTech']>({
    locationShare: 0,
    techShare: 0,
    diff: 0,
  });
  const [appliedPct, setAppliedPct] = useState(0);
  const [activeTechs, setActiveTechs] = useState<string[]>([]);
  const lastFetchRef = useRef<string | null>(null);

  // Closed Jobs Breakdown — column visibility state (display-only)
  const [columnsPreset, setColumnsPreset] = useState<PresetId>('admin');
  const [columnsVisibility, setColumnsVisibility] = useState<Record<ColKey, boolean>>(() => visibilityFromPreset('admin'));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(columnsMenuRef, () => setColumnsOpen(false));

  // Load persisted preset/visibility on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { preset?: PresetId; visibility?: Partial<Record<ColKey, boolean>> };
      if (parsed.preset && parsed.preset !== 'custom' && PRESET_VISIBLE[parsed.preset as Exclude<PresetId, 'custom'>]) {
        const vis = visibilityFromPreset(parsed.preset as Exclude<PresetId, 'custom'>);
        setColumnsPreset(parsed.preset);
        setColumnsVisibility(vis);
        return;
      }
      if (parsed.visibility) {
        const merged = { ...visibilityFromPreset('admin'), ...parsed.visibility } as Record<ColKey, boolean>;
        setColumnsVisibility(merged);
        setColumnsPreset(detectPreset(merged));
      }
    } catch (err) {
      console.error('Failed to load column preset', err);
    }
  }, []);

  // Persist preset/visibility on change
  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify({ preset: columnsPreset, visibility: columnsVisibility }));
    } catch (err) {
      console.error('Failed to persist column preset', err);
    }
  }, [columnsPreset, columnsVisibility]);

  const visibleByGroup = useMemo(
    () => COLUMN_GROUPS.map((g) => ({ ...g, visibleCount: g.cols.filter((c) => columnsVisibility[c.key]).length })),
    [columnsVisibility]
  );
  const visibleCols = useMemo(
    () => COLUMN_GROUPS.flatMap((g) => g.cols.filter((c) => columnsVisibility[c.key])),
    [columnsVisibility]
  );
  const totalVisibleCount = visibleCols.length;

  const selectColumnsPreset = (id: Exclude<PresetId, 'custom'>) => {
    setColumnsPreset(id);
    setColumnsVisibility(visibilityFromPreset(id));
  };
  const toggleColumn = (key: ColKey) => {
    setColumnsVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setColumnsPreset(detectPreset(next));
      return next;
    });
  };
  const showAllInGroup = (groupId: ColGroupId) => {
    setColumnsVisibility((prev) => {
      const next = { ...prev };
      const grp = COLUMN_GROUPS.find((g) => g.id === groupId);
      if (grp) grp.cols.forEach((c) => { next[c.key] = true; });
      setColumnsPreset(detectPreset(next));
      return next;
    });
  };
  const resetToFullAdmin = () => selectColumnsPreset('admin');

  useEffect(() => {
    // Restore from sessionStorage on mount
    const saved = sessionStorage.getItem('balance-report-filters');
    if (saved) {
      try {
        const { start, end, tech, mode: savedMode } = JSON.parse(saved);
        if (start) {
          setStartDate(start);
          setAppliedStart(start);
        }
        if (end) {
          setEndDate(end);
          setAppliedEnd(end);
        }
        if (tech) {
          setTechFilter(tech);
          setAppliedTech(tech);
        }
        if (savedMode) {
          setMode(savedMode);
        }
      } catch (e) {
        console.error('Failed to parse saved filters', e);
      }
    }

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
      const [techs, locations] = await Promise.all([
        fetchList('/api/techs'),
        fetchList('/api/locations'),
      ]);
      setLookups({ techs, locations });

      // Only set default if nothing was restored from sessionStorage
      const saved = sessionStorage.getItem('balance-report-filters');
      if (!saved && !appliedTech && techs.length) {
        const firstTech = techs[0]?._id ?? '';
        setTechFilter(firstTech);
        setAppliedTech(firstTech);
      }
    };
    fetchLookups();
  }, []); // Run only once on mount

  const fetchReport = async (params: { start: string; end: string; tech: string; mode: 'tech' | 'location' }) => {
    const search = new URLSearchParams();
    search.set('startDate', params.start);
    search.set('endDate', params.end);
    if (params.tech) search.set('tech', params.tech);
    search.set('mode', params.mode);
    const fetchKey = search.toString();

    // Deduplicate
    if (lastFetchRef.current === fetchKey) return;
    lastFetchRef.current = fetchKey;

    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/balance-report?${fetchKey}`);
      if (!res.ok) throw new Error('Failed to load balance report');
      const data = (await res.json()) as ApiResponse;
      setRows(data.rows || []);
      setTotals(data.totals || { assigned: 0, profit: 0, avgTicket: 0, avgClosedJob: 0 });
      setStatusStats(data.statusStats || []);
      setLocationVsTech(data.locationVsTech || { locationShare: 0, techShare: 0, diff: 0 });
      setAppliedPct(data.appliedPct || 0);
      setActiveTechs(data.activeTechs || []);
      setFiltersDirty(false);
    } catch (err) {
      console.error('Failed to load balance report', err);
      setError('Failed to load balance report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Don't fetch until we have a tech selected (prevents initial fetch with empty tech)
    if (!appliedTech) return;

    fetchReport({ start: appliedStart, end: appliedEnd, tech: appliedTech, mode });
  }, [appliedStart, appliedEnd, appliedTech, mode]);

  const statusTotal = useMemo(() => statusStats.reduce((sum, s) => sum + s.count, 0), [statusStats]);
  const closedRows = useMemo(
    () => rows.filter((r) => (r.status || '').toLowerCase() === 'closed'),
    [rows]
  );
  const closedTotals = useMemo(
    () =>
      closedRows.reduce(
        (acc, r) => {
          acc.paidSum += r.paidSum || 0;
          acc.techParts += r.techParts || 0;
          acc.companyParts += r.companyParts || 0;
          acc.lmParts += r.lmParts || 0;
          acc.lmCash += r.lmCash || 0;
          acc.lmCheck += r.lmCheck || 0;
          acc.paymentFee += r.paymentFee || 0;
          acc.totalProfit += r.totalProfit || 0;
          acc.shareAmount += r.shareAmount || 0;
          acc.techPaidCash += r.techPaidCash || 0;
          acc.balance += r.balance || 0;
          acc.tipsTotal += r.tipsTotal || 0;
          acc.techOwedToLm += r.techOwedToLm || 0;
          acc.lmOwesCompany += r.lmOwesCompany || 0;
          return acc;
        },
        {
          paidSum: 0,
          techParts: 0,
          companyParts: 0,
          lmParts: 0,
          lmCash: 0,
          lmCheck: 0,
          paymentFee: 0,
          totalProfit: 0,
          shareAmount: 0,
          techPaidCash: 0,
          balance: 0,
          tipsTotal: 0,
          techOwedToLm: 0,
          lmOwesCompany: 0,
        }
      ),
    [closedRows]
  );

  const statusPieData = useMemo<PieDatum[]>(
    () =>
      statusStats.map((s, idx) => {
        const value = s.count;
        const percent = statusTotal ? Math.round((value / statusTotal) * 1000) / 10 : 0;
        return { name: s.key || 'Unknown', value, percent, color: colorForIndex(idx) };
      }),
    [statusStats, statusTotal]
  );

  type PieTooltipProps = TooltipProps<number, string> & { payload?: Array<{ payload: PieDatum }> };

  const PieTooltip = ({ active, payload }: PieTooltipProps) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload as PieDatum;
    return (
      <div className="pie-tooltip">
        <div className="pie-tooltip__title">{data.name}</div>
        <div className="pie-tooltip__row">
          <span>Jobs</span>
          <strong>{data.value}</strong>
        </div>
        <div className="pie-tooltip__row">
          <span>Percent</span>
          <strong>{data.percent}%</strong>
        </div>
      </div>
    );
  };

  const applyFilters = () => {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setAppliedTech(techFilter);
    setFiltersDirty(false);

    // Force fetch for refresh icon (case where nothing changed)
    lastFetchRef.current = null;
    fetchReport({ start: startDate, end: endDate, tech: techFilter, mode });

    // Persist to sessionStorage
    sessionStorage.setItem('balance-report-filters', JSON.stringify({
      start: startDate,
      end: endDate,
      tech: techFilter,
      mode
    }));
  };

  const titleSubject = mode === 'tech' ? appliedTech : lookups.locations.find((l) => l._id === (lookups.techs.find((t) => t._id === appliedTech)?.location || ''))?._id || '';

  // Display-only date formatter
  const fmtDateChip = (s: string) =>
    s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  return (
    <main className="balance-page">
      {loading && closedRows.length > 0 && <div className="top-progress" />}

      <div className="content">

        {/* ── Page Header ── */}
        <header className="bp-header animate-fade-up">
          <div className="bp-header-left">
            <p className="bp-kicker">{mode === 'tech' ? 'Tech Report' : 'Location Report'}</p>
            <h1 className="bp-title">{titleSubject || '—'}</h1>
            <div className="bp-meta">
              <span className="bp-meta-chip">
                <span className="bp-meta-chip-label">Applied</span>
                <strong>{appliedPct}%</strong>
              </span>
              <span className="bp-meta-chip">
                <span className="bp-meta-chip-label">Range</span>
                <strong>{fmtDateChip(appliedStart)} → {fmtDateChip(appliedEnd)}</strong>
              </span>
            </div>
          </div>
          <div className="bp-rows-badge">
            <span className="bp-rows-dot" />
            <strong className="bp-rows-num">{closedRows.length}</strong>
            <span className="bp-rows-label">Closed Jobs</span>
          </div>
        </header>

        {/* ── Horizontal Filters ── */}
        <FiltersPanel
          direction="horizontal"
          loading={loading}
          filtersDirty={filtersDirty}
          onApply={applyFilters}
          error={error}
        >
          <FilterField label="Mode">
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as 'tech' | 'location');
                setFiltersDirty(true);
              }}
            >
              <option value="tech">Tech Report</option>
              <option value="location">Location Report</option>
            </select>
          </FilterField>
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
            <select
              value={techFilter}
              onChange={(e) => {
                setTechFilter(e.target.value);
                setFiltersDirty(true);
              }}
            >
              {lookups.techs
                .filter((t) => activeTechs.includes(t._id))
                .map((t) => (
                  <option key={t._id} value={t._id}>
                    {t._id}
                  </option>
                ))}
            </select>
          </FilterField>
        </FiltersPanel>

        {/* ── KPI Strip ── */}
        <section className="bp-kpi-strip stagger">
          <BpKpi label="Assigned Jobs" value={String(totals.assigned)} icon={<FiBriefcase size={14} />} accent="indigo" />
          <BpKpi label="Avg Ticket" value={formatCurrency(totals.avgTicket)} icon={<FiPercent size={14} />} accent="cyan" />
          <BpKpi label="Job Profit" value={formatCurrency(totals.profit)} icon={<FiTrendingUp size={14} />} accent="emerald" />
          <BpKpi label="Avg Closed Job" value={formatCurrency(totals.avgClosedJob)} icon={<FiCheckCircle size={14} />} accent="violet" />
          <BpKpi label="Tech Owes LM" value={formatCurrency(closedTotals.techOwedToLm)} icon={<FiAlertCircle size={14} />} accent="amber" />
          <BpKpi label="LM Owes Company" value={formatCurrency(closedTotals.lmOwesCompany)} icon={<FiDollarSign size={14} />} accent="cyan" />
          {mode === 'location' && (
            <>
              <BpKpi label="Profit on Tech" value={formatCurrency(locationVsTech.diff)} icon={<FiDollarSign size={14} />} accent="emerald" />
              <BpKpi label="Loss on Tech" value="—" icon={<FiAlertCircle size={14} />} accent="red" />
            </>
          )}
        </section>

        {/* ── Mid Row: Status Pie + Snapshot ── */}
        <div className="bp-mid-row">

          {/* Status pie */}
          <div className="panel chart-card animate-fade-up">
            <div className="panel-header">
              <div>
                <p className="bp-section-kicker">Distribution</p>
                <h3>Jobs by Status</h3>
              </div>
              <span className="bp-pill">{statusTotal} total</span>
            </div>
            <div className="chart-body">
              <div className="pie-shell">
                {statusPieData.length ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={1}
                        animationDuration={650}
                      >
                        {statusPieData.map((entry, idx) => (
                          <Cell key={`${entry.name}-${idx}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} isAnimationActive={false} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState size="sm" title="No data" />
                )}
              </div>
              <div className="legend">
                {statusPieData.map((item, idx) => (
                  <div
                    key={item.name || idx}
                    className="legend-row"
                    title={`${item.name}: ${item.value} (${item.percent}%)`}
                  >
                    <span className="dot" style={{ background: item.color }} />
                    <span className="label">{item.name}</span>
                    <span className="muted small">
                      {item.value} ({item.percent}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Snapshot card */}
          <div className="panel bp-snapshot animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="panel-header">
              <div>
                <p className="bp-section-kicker">Closed Jobs Snapshot</p>
                <h3>Quick Totals</h3>
              </div>
            </div>
            {closedRows.length ? (
              <ul className="bp-snapshot-list">
                <li>
                  <span className="bp-snap-label">Total Paid</span>
                  <span className="bp-snap-value">{formatCurrency(closedTotals.paidSum)}</span>
                </li>
                <li>
                  <span className="bp-snap-label">Total Profit</span>
                  <span className="bp-snap-value">{formatCurrency(closedTotals.totalProfit)}</span>
                </li>
                <li>
                  <span className="bp-snap-label">Tech Payout</span>
                  <span className="bp-snap-value">{formatCurrency(closedTotals.shareAmount)}</span>
                </li>
                <li>
                  <span className="bp-snap-label">Cash Collected</span>
                  <span className="bp-snap-value">{formatCurrency(closedTotals.techPaidCash)}</span>
                </li>
                <li className="bp-snap-divider" />
                <li>
                  <span className="bp-snap-label">Balance</span>
                  <span
                    className="bp-snap-value"
                    style={{
                      color:
                        closedTotals.balance * -1 < 0 ? '#f87171' :
                        closedTotals.balance * -1 > 0 ? '#34d399' : undefined,
                    }}
                  >
                    {formatCurrency(closedTotals.balance * -1)}
                  </span>
                </li>
                <li>
                  <span className="bp-snap-label">Balance + Tips</span>
                  <span
                    className="bp-snap-value bp-snap-strong"
                    style={{
                      color:
                        (closedTotals.balance + closedTotals.tipsTotal) * -1 < 0 ? '#f87171' :
                        (closedTotals.balance + closedTotals.tipsTotal) * -1 > 0 ? '#34d399' : undefined,
                    }}
                  >
                    {formatCurrency((closedTotals.balance + closedTotals.tipsTotal) * -1)}
                  </span>
                </li>
                <li className="bp-snap-divider" />
                <li>
                  <span className="bp-snap-label">Tech Owes LM</span>
                  <span className="bp-snap-value" style={{ color: closedTotals.techOwedToLm > 0 ? '#fbbf24' : undefined }}>
                    {formatCurrency(closedTotals.techOwedToLm)}
                  </span>
                </li>
                <li>
                  <span className="bp-snap-label">LM Owes Company</span>
                  <span className="bp-snap-value" style={{ color: closedTotals.lmOwesCompany > 0 ? '#22d3ee' : undefined }}>
                    {formatCurrency(closedTotals.lmOwesCompany)}
                  </span>
                </li>
              </ul>
            ) : (
              <EmptyState size="sm" title="No closed jobs" message="Apply filters or change date range." />
            )}
          </div>
        </div>

        {/* ── Main Table ── */}
        <div className="panel bp-table-panel animate-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="panel-header">
            <div>
              <p className="bp-section-kicker">Detail</p>
              <h3>Closed Jobs Breakdown</h3>
            </div>
            <div ref={columnsMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => setColumnsOpen((o) => !o)}
                className="bp-pill"
                aria-haspopup="menu"
                aria-expanded={columnsOpen}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0' }}
              >
                <span>View: <strong>{PRESET_LABELS[columnsPreset]}</strong></span>
                <span style={{ opacity: 0.6 }}>· {totalVisibleCount}/{ALL_COL_KEYS.length}</span>
                <FiChevronDown size={12} />
              </button>
              <span className="bp-pill">{closedRows.length} rows</span>
              {columnsOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
                    minWidth: 320, maxHeight: '70vh', overflowY: 'auto',
                    background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 12, boxShadow: '0 12px 30px rgba(0,0,0,0.5)', padding: 12, fontSize: 13,
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 0.6, marginBottom: 6 }}>Preset</div>
                  {(['admin', 'tech', 'lm'] as const).map((p) => (
                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', borderRadius: 6 }}>
                      <input type="radio" name="bp-preset" checked={columnsPreset === p} onChange={() => selectColumnsPreset(p)} />
                      {PRESET_LABELS[p]}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6, opacity: columnsPreset === 'custom' ? 1 : 0.5 }}>
                    <input type="radio" name="bp-preset" checked={columnsPreset === 'custom'} readOnly disabled />
                    {PRESET_LABELS.custom} <span style={{ fontSize: 11, color: '#94a3b8' }}>(auto when you change a checkbox)</span>
                  </label>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '10px 0' }} />

                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 0.6, marginBottom: 6 }}>Columns</div>
                  {COLUMN_GROUPS.map((g) => (
                    <div key={g.id} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ fontSize: 12 }}>{g.label}</strong>
                        <button type="button" onClick={() => showAllInGroup(g.id)} style={{ fontSize: 11, color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                          Show all
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                        {g.cols.map((c) => (
                          <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                            <input type="checkbox" checked={columnsVisibility[c.key]} onChange={() => toggleColumn(c.key)} />
                            {c.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '10px 0' }} />

                  <button
                    type="button"
                    onClick={resetToFullAdmin}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', cursor: 'pointer', fontSize: 12 }}
                  >
                    Reset to Full Admin View
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="balance-table" style={{ position: 'relative' }}>
            {loading && closedRows.length === 0 && <LoadingOverlay message="Loading balance report..." />}
            <table>
              <thead>
                <tr className="bp-group-row">
                  {visibleByGroup.filter((g) => g.visibleCount > 0).map((g) => (
                    <th key={g.id} colSpan={g.visibleCount} className={`bp-group ${g.cssClass}`}>{g.label}</th>
                  ))}
                </tr>
                <tr>
                  {visibleCols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closedRows.map((job) => (
                  <tr key={job.id}>
                    {visibleCols.map((c) => c.renderBody(job))}
                  </tr>
                ))}
                {!closedRows.length && !loading && (
                  <tr className="empty-row">
                    <td colSpan={Math.max(1, totalVisibleCount)}>
                      <EmptyState
                        size="md"
                        title="No closed jobs"
                        message="Try a different date range or technician."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
              {closedRows.length > 0 && totalVisibleCount > 0 && (
                <tfoot>
                  <tr className="totals-row">
                    {visibleByGroup[0].visibleCount > 0 && (
                      <td className="totals-cell" colSpan={visibleByGroup[0].visibleCount}>Totals</td>
                    )}
                    {visibleCols.slice(visibleByGroup[0].visibleCount).map((c) => (
                      c.renderTotal ? c.renderTotal(closedTotals) : <td key={c.key} />
                    ))}
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

/* ────────────── BP KPI tile ────────────── */

type BpAccent = 'indigo' | 'cyan' | 'emerald' | 'violet' | 'red' | 'amber';

const bpAccents: Record<BpAccent, { bg: string; border: string; text: string; glow: string }> = {
  indigo:  { bg: 'rgba(99,102,241,0.10)',  border: 'rgba(99,102,241,0.25)',  text: '#a5b4fc', glow: 'rgba(99,102,241,0.12)' },
  cyan:    { bg: 'rgba(6,182,212,0.10)',   border: 'rgba(6,182,212,0.25)',   text: '#22d3ee', glow: 'rgba(6,182,212,0.10)'  },
  emerald: { bg: 'rgba(16,185,129,0.10)',  border: 'rgba(16,185,129,0.25)',  text: '#34d399', glow: 'rgba(16,185,129,0.10)' },
  violet:  { bg: 'rgba(139,92,246,0.10)',  border: 'rgba(139,92,246,0.25)',  text: '#c4b5fd', glow: 'rgba(139,92,246,0.10)' },
  red:     { bg: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.25)',   text: '#f87171', glow: 'rgba(239,68,68,0.10)'  },
  amber:   { bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.25)',  text: '#fbbf24', glow: 'rgba(245,158,11,0.10)' },
};

function BpKpi({ label, value, icon, accent }: { label: string; value: string; icon: ReactNode; accent: BpAccent }) {
  const a = bpAccents[accent];
  return (
    <div className="bp-kpi hover-lift">
      <div
        className="bp-kpi-glow"
        style={{ background: `radial-gradient(circle at top right, ${a.glow}, transparent 70%)` }}
      />
      <div className="bp-kpi-row">
        <div className="bp-kpi-icon" style={{ background: a.bg, color: a.text, border: `1px solid ${a.border}` }}>
          {icon}
        </div>
        <span className="bp-kpi-label">{label}</span>
      </div>
      <div className="bp-kpi-value">{value}</div>
    </div>
  );
}
