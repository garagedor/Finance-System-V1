'use client';

/* Design 360 — small primitives. Presentation only. */

import './ui.css';

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'neutral';

/* ── Button ───────────────────────────────────────────────────────────── */
export function Button({
  variant = 'default', size, children, ...rest
}: {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ['u-btn', variant !== 'default' ? variant : '', size ?? ''].filter(Boolean).join(' ');
  return <button className={cls} {...rest}>{children}</button>;
}

/* ── Status badge — semantic only. Never tinted with a portal hue, so
      "this is Finance" and "this is broken" can never be confused. ────── */
export function StatusBadge({ tone = 'neutral', children, plain }: {
  tone?: Tone; children: React.ReactNode; plain?: boolean;
}) {
  return <span className={`u-badge ${tone}${plain ? ' plain' : ''}`}>{children}</span>;
}

/** Maps the strings the business already uses onto the semantic set, so
 *  existing status values render consistently without being renamed. */
export function toneForStatus(status: string): Tone {
  const s = status.toLowerCase();
  if (/(closed|paid|approved|complete|settled|received|done|active|live)/.test(s)) return 'ok';
  if (/(pending|review|progress|partial|draft|awaiting|open|submitted)/.test(s)) return 'warn';
  if (/(cancel|dispute|refund|fail|overdue|missing|damaged|reject)/.test(s)) return 'crit';
  return 'neutral';
}

/* ── Empty state — says what is absent and what to do next ────────────── */
export function EmptyState({ icon, title, description, actions }: {
  icon?: React.ReactNode; title: string; description?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="u-empty">
      {icon && <div className="u-empty-ico">{icon}</div>}
      <p className="u-empty-t">{title}</p>
      {description && <p className="u-empty-d">{description}</p>}
      {actions && <div className="u-empty-a">{actions}</div>}
    </div>
  );
}

/* ── Skeleton — shaped like the content that will arrive ──────────────── */
export function Skeleton({ width, height }: { width?: string | number; height?: number }) {
  return <div className="u-skel" style={{ width: width ?? '100%', height: height ?? 12 }} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  const widths = ['72%', '48%', '63%', '55%', '80%', '41%'];
  return (
    <div className="u-skel-rows" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}

/* ── Tabs — only where they genuinely reduce page complexity ──────────── */
export interface TabDef { key: string; label: string; count?: number }

export function Tabs({ tabs, active, onChange }: {
  tabs: TabDef[]; active: string; onChange: (key: string) => void;
}) {
  return (
    <div className="u-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key}
                className={`u-tab${active === t.key ? ' is-on' : ''}`}
                onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span className="u-tab-n">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="u-seg" role="group">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'is-on' : ''}
                onClick={() => onChange(o.value)} type="button">{o.label}</button>
      ))}
    </div>
  );
}

/* ── Command / search entry — visual pattern only, no backend yet ─────── */
export function CommandEntry({ placeholder = 'Search jobs, technicians, invoices…', onOpen }: {
  placeholder?: string; onOpen?: () => void;
}) {
  return (
    <button className="u-cmd" type="button" onClick={onOpen}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <span>{placeholder}</span>
      <span className="u-cmd-k">⌘K</span>
    </button>
  );
}
