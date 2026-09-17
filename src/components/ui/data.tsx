'use client';

/* Design 360 — data-accessibility components.
   Each one exists to answer "how does this help someone understand the
   business faster?" — hence trend on every metric, a summary strip above
   detail, and filters that collapse rather than crowd. */

import Link from 'next/link';
import { Skeleton } from './primitives';
import './ui.css';

/* ── Metric card ──────────────────────────────────────────────────────── */
export interface MetricProps {
  label: string;
  /** Omit to render a pending dash. Never invent a zero. */
  value?: string;
  unit?: string;
  icon?: React.ReactNode;
  /** Colour of the icon tile. `accent` picks up the portal hue. */
  iconTone?: 'neutral' | 'ok' | 'warn' | 'crit' | 'accent';
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; /** a rise is not always good */ goodWhen?: 'up' | 'down' };
  /** e.g. "vs last week" — a number without a comparison is hard to judge. */
  comparison?: string;
  href?: string;
  loading?: boolean;
}

export function MetricCard(p: MetricProps) {
  const body = (
    <>
      <div className="u-metric-top">
        {p.icon && <span className={`u-metric-ico ${p.iconTone ?? 'neutral'}`}>{p.icon}</span>}
        <span className="u-metric-l">{p.label}</span>
      </div>

      {p.loading ? (
        <div style={{ marginBottom: 'var(--ds-space-2)' }}><Skeleton width="62%" height={26} /></div>
      ) : (
        <div className="u-metric-v">
          {p.value ?? <span style={{ color: 'var(--ds-ink-dim)' }}>—</span>}
          {p.unit && p.value && <span className="u-unit"> {p.unit}</span>}
        </div>
      )}

      <div className="u-metric-f">
        {p.trend && !p.loading && (
          <span className={trendClass(p.trend)}>
            {p.trend.direction === 'up' ? '▲' : p.trend.direction === 'down' ? '▼' : '—'} {p.trend.label}
          </span>
        )}
        {p.comparison && <span className="u-metric-cmp">{p.comparison}</span>}
      </div>
    </>
  );

  return p.href
    ? <Link href={p.href} className="u-metric">{body}</Link>
    : <div className="u-metric">{body}</div>;
}

function trendClass(t: NonNullable<MetricProps['trend']>): string {
  const base = `u-trend ${t.direction}`;
  if (!t.goodWhen || t.direction === 'flat') return base;
  const isGood = t.direction === t.goodWhen;
  return `${base} ${isGood ? (t.direction === 'down' ? 'is-good' : '') : (t.direction === 'up' ? 'is-bad' : '')}`.trim();
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="u-metrics">{children}</div>;
}

/* ── Summary strip — compact key values directly above detail ─────────── */
export interface StripItem { label: string; value?: string; sub?: string; tone?: 'pos' | 'neg' | 'muted' }

export function SummaryStrip({ items }: { items: StripItem[] }) {
  return (
    <div className="u-strip">
      {items.map((i) => (
        <div className="u-strip-i" key={i.label}>
          <div className="u-strip-l">{i.label}</div>
          <div className={`u-strip-v${i.tone ? ' ' + i.tone : ''}`}>
            {i.value ?? <span style={{ color: 'var(--ds-ink-dim)' }}>—</span>}
          </div>
          {i.sub && <div className="u-strip-s">{i.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── Alert card — an exception that needs a decision ──────────────────── */
export function AlertCard({ tone = 'info', icon, title, description, actions }: {
  tone?: 'ok' | 'warn' | 'crit' | 'info';
  icon?: React.ReactNode; title: string; description?: string; actions?: React.ReactNode;
}) {
  return (
    <div className={`u-alert ${tone}`} role={tone === 'crit' ? 'alert' : undefined}>
      {icon && <span className="u-alert-ico">{icon}</span>}
      <div className="u-alert-b">
        <p className="u-alert-t">{title}</p>
        {description && <p className="u-alert-d">{description}</p>}
      </div>
      {actions && <div className="u-alert-a">{actions}</div>}
    </div>
  );
}

/* ── Filters — primary chips inline, everything else behind a drawer ──── */
export interface FilterChip { key: string; label: string; active?: boolean; removable?: boolean }

export function FilterBar({ chips, onToggle, onRemove, onClear, onAdvanced }: {
  chips: FilterChip[];
  onToggle?: (key: string) => void;
  onRemove?: (key: string) => void;
  onClear?: () => void;
  onAdvanced?: () => void;
}) {
  const anyActive = chips.some((c) => c.active);
  return (
    <div className="u-filters">
      {chips.map((c) => (
        <button key={c.key} type="button"
                className={`u-chip${c.active ? ' is-on' : ''}`}
                onClick={() => (c.removable && c.active ? onRemove?.(c.key) : onToggle?.(c.key))}>
          {c.label}
          {c.active && c.removable && <span className="u-chip-x" aria-hidden="true">×</span>}
        </button>
      ))}
      {onAdvanced && (
        <button type="button" className="u-chip" onClick={onAdvanced}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" aria-hidden="true"><path d="M3 6h18M7 12h10M11 18h2" /></svg>
          More filters
        </button>
      )}
      {anyActive && onClear && (
        <button type="button" className="u-filter-clear" onClick={onClear}>Clear all</button>
      )}
    </div>
  );
}

/* ── Table shell ──────────────────────────────────────────────────────────
   A VISUAL WRAPPER ONLY. It owns search, filters, counts, selection chrome
   and pagination layout — never the query, the sort or the data. Existing
   table logic passes straight through as `children`.                       */
export function TableShell({
  search, onSearch, searchPlaceholder = 'Search…',
  count, countLabel = 'results',
  tools, filters, selected = 0, bulkActions, footer,
  dense, stackable = true, children,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  count?: number;
  countLabel?: string;
  tools?: React.ReactNode;
  filters?: React.ReactNode;
  selected?: number;
  bulkActions?: React.ReactNode;
  footer?: React.ReactNode;
  dense?: boolean;
  /** On phones, rows stack into records instead of scrolling sideways. */
  stackable?: boolean;
  children: React.ReactNode;
}) {
  const cls = ['u-table', dense ? 'is-dense' : '', stackable ? 'is-stackable' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {(onSearch || count != null || tools) && (
        <div className="u-table-bar">
          {onSearch && (
            <label className="u-table-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input value={search ?? ''} placeholder={searchPlaceholder}
                     onChange={(e) => onSearch(e.target.value)} aria-label={searchPlaceholder} />
            </label>
          )}
          {count != null && (
            <span className="u-table-count">
              {count.toLocaleString()} {countLabel}
            </span>
          )}
          {tools && <div className="u-table-tools">{tools}</div>}
        </div>
      )}

      {filters && <div className="u-table-bar" style={{ borderTop: 'none' }}>{filters}</div>}

      {selected > 0 && (
        <div className="u-bulk">
          <span className="u-bulk-n">{selected} selected</span>
          {bulkActions && <span className="u-bulk-actions">{bulkActions}</span>}
        </div>
      )}

      <div className="u-table-scroll">{children}</div>

      {footer && <div className="u-table-foot">{footer}</div>}
    </div>
  );
}
