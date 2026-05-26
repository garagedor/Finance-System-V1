'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { formatCurrency } from '../utils/jobUtils';
import './styles.css';
import { Technician, Location, Provider } from '@/types/job';
import FiltersPanel, { FilterField } from '@/components/FiltersPanel';
import MultiSelect from '@/components/MultiSelect';
import { useFilterRelationships } from '@/hooks/useFilterRelationships';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useAuth } from '@/components/AuthShell';
import DateRangePicker from '@/components/DateRangePicker';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import EmptyState from '@/components/EmptyState';

type StatRow = { key: string; count: number; totalAmount: number; totalPaid: number; closedCount?: number };
type StatusRow = { key: string; count: number };
type StatsResponse = {
  summary: {
    count: number;
    totalAmount: number;
    totalPaid: number;
    totalProfit: number;
    avgTicket: number;
    avgTicketWithoutPenalty: number;
    avgClosedTicket: number;
    closedRatio: number;
  };
  byLocation: StatRow[];
  byStatus: StatusRow[];
  byTech: StatRow[];
  byProvider: StatRow[];
};

const emptyStats: StatsResponse = {
  summary: {
    count: 0,
    totalAmount: 0,
    totalPaid: 0,
    totalProfit: 0,
    avgTicket: 0,
    avgTicketWithoutPenalty: 0,
    avgClosedTicket: 0,
    closedRatio: 0,
  },
  byTech: [],
  byLocation: [],
  byStatus: [],
  byProvider: [],
};

const BRAND_PALETTE = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#84cc16', // lime
  '#0ea5e9', // sky
  '#f43f5e', // rose
  '#a855f7', // purple
];
const colorForIndex = (idx: number) => BRAND_PALETTE[idx % BRAND_PALETTE.length];
const formatDateInput = (d: Date) => d.toISOString().slice(0, 10);
const defaultEndDate = formatDateInput(new Date());
const defaultStartDate = formatDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

type PieDatum = { name: string; value: number; percent: number; color: string };

export default function StatsPage() {
  const { user } = useAuth();
  const { narrowTechs, narrowLocations, narrowProviders } = useFilterRelationships();
  const [stats, setStats] = useState<StatsResponse>(emptyStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [techs, setTechs] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [providerFilter, setProviderFilter] = useState<string[]>([]);

  const [activeFilters, setActiveFilters] = useState({
    techs: [] as string[],
    locations: [] as string[],
    providers: [] as string[],
    startDate: defaultStartDate,
    endDate: defaultEndDate,
  });

  const [isInitialized, setIsInitialized] = useState(false);
  const lastFetchRef = useRef<string | null>(null);
  const lookupsFetchedRef = useRef(false);

  const [filtersDirty, setFiltersDirty] = useState(false);
  const [lookups, setLookups] = useState<{ techs: Technician[]; locations: Location[]; providers: Provider[] }>({
    techs: [],
    locations: [],
    providers: [],
  });

  useEffect(() => {
    // Restore from sessionStorage on mount
    const saved = sessionStorage.getItem('stats-filters');
    if (saved) {
      try {
        const { start, end, techs: savedTechs, locations: savedLocs, providers: savedProvs, location, provider } = JSON.parse(saved);

        const active = {
          techs: [] as string[],
          locations: [] as string[],
          providers: [] as string[],
          startDate: defaultStartDate,
          endDate: defaultEndDate,
        };

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
        // Accept new array shape, fall back to legacy single-string for migration.
        const locs = Array.isArray(savedLocs) ? savedLocs : (location ? [location] : []);
        if (locs.length) {
          setLocationFilter(locs);
          active.locations = locs;
        }
        const provs = Array.isArray(savedProvs) ? savedProvs : (provider ? [provider] : []);
        if (provs.length) {
          setProviderFilter(provs);
          active.providers = provs;
        }

        setActiveFilters(active);
        setFiltersDirty(false);
      } catch (e) {
        console.error('Failed to parse saved stats filters', e);
      }
    }

    setIsInitialized(true);
  }, []);

  const handleApply = () => {
    const nextActive = {
      techs,
      locations: locationFilter,
      providers: providerFilter,
      startDate,
      endDate,
    };
    setActiveFilters(nextActive);

    // Force fetch for refresh icon
    lastFetchRef.current = null;
    fetchStats();

    // Persist to sessionStorage
    sessionStorage.setItem('stats-filters', JSON.stringify({
      start: startDate,
      end: endDate,
      techs,
      locations: locationFilter,
      providers: providerFilter,
    }));
  };

  const fetchStats = async () => {
    const params = new URLSearchParams();
    if (activeFilters.startDate) params.set('startDate', activeFilters.startDate);
    if (activeFilters.endDate) params.set('endDate', activeFilters.endDate);
    (activeFilters.techs || []).forEach(t => params.append('tech', t));
    (activeFilters.locations || []).forEach((l) => params.append('location', l));
    (activeFilters.providers || []).forEach((p) => params.append('provider', p));
    
    const fetchKey = params.toString();

    // Deduplicate
    if (lastFetchRef.current === fetchKey) return;
    lastFetchRef.current = fetchKey;

    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/stats?${fetchKey}`);
      
      // Prevent race conditions: discard the result if a newer fetch was started
      if (lastFetchRef.current !== fetchKey) return;

      if (!res.ok) {
        throw new Error('Failed to load stats');
      }
      const data = (await res.json()) as StatsResponse;
      setStats(data);
      setFiltersDirty(false);
    } catch (err) {
      console.error('Failed to load stats', err);
      if (lastFetchRef.current === fetchKey) {
        setError('Failed to load stats');
      }
    } finally {
      if (lastFetchRef.current === fetchKey) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isInitialized) {
      fetchStats();
    }
  }, [activeFilters, isInitialized]);

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

    const loadLookups = async () => {
      const [techs, locations, providers] = await Promise.all([
        fetchList('/api/techs'),
        fetchList('/api/locations'),
        fetchList('/api/providers'),
      ]);
      setLookups({ techs, locations, providers });
    };
    loadLookups();
  }, []);

  const statusTotal = useMemo(
    () => stats.byStatus.reduce((sum, s) => sum + s.count, 0),
    [stats.byStatus]
  );

  const techTotal = useMemo(() => stats.byTech.reduce((sum, t) => sum + t.count, 0), [stats.byTech]);

  const closedTotal = useMemo(
    () => stats.byLocation.reduce((sum, l) => sum + (l.closedCount ?? l.count), 0),
    [stats.byLocation]
  );

  const statusPieData = useMemo<PieDatum[]>(
    () =>
      stats.byStatus.map((s, idx) => {
        const value = s.count;
        const percent = statusTotal ? Math.round((value / statusTotal) * 1000) / 10 : 0;
        return { name: s.key || 'Unknown', value, percent, color: colorForIndex(idx) };
      }),
    [stats.byStatus, statusTotal]
  );

  const locationPieData = useMemo<PieDatum[]>(
    () =>
      stats.byLocation.map((l, idx) => {
        const value = l.closedCount ?? l.count;
        const percent = closedTotal ? Math.round((value / closedTotal) * 1000) / 10 : 0;
        return { name: l.key || 'Unknown', value, percent, color: colorForIndex(idx) };
      }),
    [closedTotal, stats.byLocation]
  );

  const techPieData = useMemo<PieDatum[]>(
    () =>
      stats.byTech.map((t, idx) => {
        const value = t.count;
        const percent = techTotal ? Math.round((value / techTotal) * 1000) / 10 : 0;
        return { name: t.key || 'Unknown', value, percent, color: colorForIndex(idx) };
      }),
    [stats.byTech, techTotal]
  );

  const providerTotal = useMemo(() => stats.byProvider.reduce((sum, p) => sum + p.count, 0), [stats.byProvider]);

  const providerPieData = useMemo<PieDatum[]>(
    () =>
      stats.byProvider.map((p, idx) => {
        const value = p.count;
        const percent = providerTotal ? Math.round((value / providerTotal) * 1000) / 10 : 0;
        return { name: p.key || 'Unknown', value, percent, color: colorForIndex(idx) };
      }),
    [stats.byProvider, providerTotal]
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

  // Admin/Location Manager-only access
  if (!user || (user.type !== 'admin' && user.type !== 'location-manager')) {
    return (
      <main className="stats-page">
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
            message="This page is only accessible to administrators."
          />
        </div>
      </main>
    );
  }

  return (
    <main className="stats-page">
      {loading && stats !== emptyStats && <div className="top-progress" />}

      <div className="layout">

        {/* ── Page Header ── */}
        <div className="stats-header animate-fade-up">
          <div>
            <p className="stats-kicker">Analytics</p>
            <h1 className="stats-title">Statistics</h1>
          </div>
        </div>

        <FiltersPanel
          direction="horizontal"
          loading={loading}
          filtersDirty={filtersDirty}
          onApply={handleApply}
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
              options={narrowTechs(lookups.techs.map((t) => t._id), locationFilter, providerFilter)}
              selected={techs}
              onChange={(vals) => {
                setTechs(vals);
                setFiltersDirty(true);
              }}
            />
          </FilterField>
          <FilterField label="Location">
            <MultiSelect
              options={narrowLocations(lookups.locations.map((l) => l._id), techs, providerFilter)}
              selected={locationFilter}
              onChange={(v) => {
                setLocationFilter(v);
                setFiltersDirty(true);
              }}
              placeholder="All"
              allLabel="All"
            />
          </FilterField>
          <FilterField label="Provider">
            <MultiSelect
              options={narrowProviders(lookups.providers.map((p) => p._id), locationFilter, techs)}
              selected={providerFilter}
              onChange={(v) => {
                setProviderFilter(v);
                setFiltersDirty(true);
              }}
              placeholder="All"
              allLabel="All"
            />
          </FilterField>
        </FiltersPanel>

        <div className="main" style={{ position: 'relative', minHeight: '300px' }}>
          {loading && stats === emptyStats && <LoadingOverlay message="Loading statistics..." />}

          {/* ── KPI Strip (5 cards including Total Balance) ── */}
          <div className="cards stagger">
            <div className="metric-card">
              <div className="muted small">Avg Closed Ticket</div>
              <div className="metric-value">{formatCurrency(stats.summary.avgClosedTicket)}</div>
            </div>
            <div className="metric-card">
              <div className="muted small">Avg Ticket</div>
              <div className="metric-value">{formatCurrency(stats.summary.avgTicket)}</div>
            </div>
            <div className="metric-card">
              <div className="muted small">Avg w/o Penalty</div>
              <div className="metric-value">{formatCurrency(stats.summary.avgTicketWithoutPenalty)}</div>
            </div>
            <div className="metric-card">
              <div className="muted small">Closed Ratio</div>
              <div className="metric-value">
                {Math.round((stats.summary.closedRatio || 0) * 100)}%
              </div>
            </div>
            <div className="metric-card metric-card-feature">
              <div className="muted small">Total Profit</div>
              <div className="metric-value metric-value-feature">{formatCurrency(stats.summary.totalProfit || 0)}</div>
            </div>
          </div>

          {/* ── Distribution Pies ── */}
          <div className="chart-row stagger">
            <DonutCard title="Jobs by Status"     total={statusTotal}   data={statusPieData}   PieTooltip={PieTooltip} />
            <DonutCard title="Avg Closed by Location" total={closedTotal} data={locationPieData} PieTooltip={PieTooltip} />
            <DonutCard title="Jobs by Tech"       total={techTotal}     data={techPieData}     PieTooltip={PieTooltip} />
            <DonutCard title="Jobs by Provider"   total={providerTotal} data={providerPieData} PieTooltip={PieTooltip} />
          </div>
        </div>
      </div>
    </main>
  );
}

/* ────────────── Donut Chart Card ────────────── */

function DonutCard({
  title, total, data, PieTooltip,
}: {
  title: string;
  total: number;
  data: PieDatum[];
  PieTooltip: React.ComponentType<any>;
}) {
  return (
    <div className="panel chart-card">
      <div className="panel-header">
        <div>
          <p className="stats-section-kicker">Distribution</p>
          <h3>{title}</h3>
        </div>
        <span className="stats-pill">{total} total</span>
      </div>
      <div className="chart-body">
        <div className="pie-shell">
          {data.length ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={80}
                    paddingAngle={1.5}
                    animationDuration={650}
                  >
                    {data.map((entry, idx) => (
                      <Cell key={`${entry.name}-${idx}`} fill={entry.color} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} isAnimationActive={false} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <div className="donut-center-value">{total}</div>
                <div className="donut-center-label">Total</div>
              </div>
            </>
          ) : (
            <EmptyState size="sm" title="No data" />
          )}
        </div>
        <div className="legend">
          {data.map((s, idx) => {
            const tip = `${s.name}: ${s.value} (${s.percent}%)`;
            return (
              <div key={s.name || idx} className="legend-row" title={tip}>
                <span className="dot" style={{ background: s.color }} />
                <span className="label">{s.name || 'Unknown'}</span>
                <span className="muted small">
                  {s.value} ({s.percent}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
