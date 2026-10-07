'use client';

/* ═══════════════════════════════════════════════════════════════════════════
   Page header — the one anatomy every screen uses.

   Available to pages from S2; adopted screen by screen in S3. No existing page
   is forced to use it, so nothing changes until a page opts in.

   Breadcrumbs are OPT-IN by design. A two-level path (Portal → Module) tells
   the reader nothing the sidebar has not already made obvious, so passing
   `crumbs` is only worthwhile once a screen is genuinely nested — a record
   inside a module, or a step inside a flow.
   ═══════════════════════════════════════════════════════════════════════════ */

import Link from 'next/link';
import './shell.css';

export interface Crumb { label: string; href?: string }
export interface HeaderKpi { label: string; value?: string }

export default function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
  kpis,
  filters,
}: {
  title: string;
  subtitle?: string;
  /** Only pass these when the screen is genuinely nested. */
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  /** A metric with no `value` renders as pending rather than inventing a number. */
  kpis?: HeaderKpi[];
  filters?: React.ReactNode;
}) {
  return (
    <div className="ph">
      {crumbs && crumbs.length > 1 && (
        <nav className="ph-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 && <span className="sep" aria-hidden="true"> / </span>}
              {c.href && i < crumbs.length - 1
                ? <Link href={c.href}>{c.label}</Link>
                : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}

      <div className="ph-top">
        <div className="ph-t">
          <h1 className="ph-title">{title}</h1>
          {subtitle && <p className="ph-sub">{subtitle}</p>}
        </div>
        {actions && <div className="ph-actions">{actions}</div>}
      </div>

      {kpis && kpis.length > 0 && (
        <div className="ph-kpis">
          {kpis.map((k) => (
            <div className="ph-kpi" key={k.label}>
              <div className="ph-kpi-l">{k.label}</div>
              <div className="ph-kpi-v">
                {k.value ?? <span style={{ color: 'var(--ds-ink-dim)' }}>—</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {filters && <div className="ph-filters">{filters}</div>}
    </div>
  );
}
