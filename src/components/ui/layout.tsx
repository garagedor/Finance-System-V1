'use client';

/* Design 360 — layout containers. Presentation only. */

import './ui.css';

/* ── Section — the repeatable content block ───────────────────────────── */
export function Section({ title, subtitle, actions, summary, children }: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** One plain-language sentence above the detail. The summary layer. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="u-sec">
      {(title || actions) && (
        <div className="u-sec-h">
          <div className="u-sec-t">
            {title && <h2 className="u-sec-title">{title}</h2>}
            {subtitle && <p className="u-sec-sub">{subtitle}</p>}
          </div>
          {actions && <div className="u-sec-actions">{actions}</div>}
        </div>
      )}
      {summary && <div className="u-sec-summary">{summary}</div>}
      {children}
    </section>
  );
}

/* ── Action bar — contextual actions, optionally sticky ───────────────── */
export function ActionBar({ label, actions, sticky }: {
  label?: React.ReactNode; actions: React.ReactNode; sticky?: boolean;
}) {
  return (
    <div className={`u-actionbar${sticky ? ' is-sticky' : ''}`}>
      {label && <span className="u-actionbar-t">{label}</span>}
      <div className="u-actionbar-a">{actions}</div>
    </div>
  );
}

/* ── Entity header ────────────────────────────────────────────────────────
   For any record page — Job, Ledger, Technician, Purchase Order, Product,
   Container. Identity, status, metadata and the key figures in one block,
   so a record answers "what is this and how is it doing?" before any tab. */
export interface EntityMeta { label: string; value: string }
export interface EntityKpi { label: string; value?: string }

export function EntityHeader({
  icon, kicker, name, status, meta, primaryAction, secondaryActions, kpis,
}: {
  icon?: React.ReactNode;
  /** e.g. "Ledger" or "Purchase order" — what kind of thing this is. */
  kicker?: string;
  name: string;
  status?: React.ReactNode;
  meta?: EntityMeta[];
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  kpis?: EntityKpi[];
}) {
  return (
    <div className="u-entity">
      <div className="u-entity-top">
        {icon && <span className="u-entity-ico">{icon}</span>}
        <div className="u-entity-t">
          {kicker && <p className="u-entity-kick">{kicker}</p>}
          <h1 className="u-entity-name">
            {name}
            {status}
          </h1>
          {meta && meta.length > 0 && (
            <div className="u-entity-meta">
              {meta.map((m) => (
                <div className="u-entity-m" key={m.label}>
                  <span className="u-entity-ml">{m.label}</span>
                  <span className="u-entity-mv">{m.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="u-entity-a">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>

      {kpis && kpis.length > 0 && (
        <div className="u-entity-kpis">
          {kpis.map((k) => (
            <div className="u-entity-k" key={k.label}>
              <div className="u-entity-kl">{k.label}</div>
              <div className="u-entity-kv">
                {k.value ?? <span style={{ color: 'var(--ds-ink-dim)' }}>—</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
