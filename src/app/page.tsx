'use client';

/* ═══════════════════════════════════════════════════════════════════════════
   Main Gateway — Design 360 v2.

   SCOPE NOTE: a NEW route. It reads the session that already exists and
   renders links. No mutation, no new API, no change to CRM or Finance
   behaviour. Deleting this folder removes the feature completely.

   Live figures are not wired yet. Rather than invent numbers, every metric
   slot renders a clearly pending state and the component is shaped to accept
   real data the moment read endpoints exist.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiSun, FiMoon, FiLogOut, FiBell, FiSearch, FiArrowRight } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import { PORTALS, grantedPortals, type PortalKey } from '@/config/portals';
import '@/styles/design-system.css';
import './gateway.css';

const GLYPH: Record<PortalKey, React.ReactNode> = {
  crm: (<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>),
  fin: (<><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  whs: (<><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>),
};

function Glyph({ k, size = 22 }: { k: PortalKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" aria-hidden="true">{GLYPH[k]}</svg>
  );
}

/** A metric slot. Renders an honest pending dash until real data is wired. */
function Kpi({ label, value, unit, note }: { label: string; value?: string; unit?: string; note?: string }) {
  return (
    <div className="gw-kpi">
      <div className="gw-kpi-l">{label}</div>
      <div className="gw-kpi-v">
        {value ?? <span style={{ color: 'var(--ds-ink-dim)' }}>—</span>}
        {unit && value && <span className="unit"> {unit}</span>}
      </div>
      <div className="gw-kpi-f">
        <span className="gw-trend fl">{note ?? 'Awaiting data'}</span>
      </div>
    </div>
  );
}

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function GatewayPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => { setNow(new Date()); }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lbs-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('lbs-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const keys = useMemo(
    () => grantedPortals(user?.permissions, user?.type),
    [user],
  );

  // ⌘1 / ⌘2 / ⌘3 — fast portal switching.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i === -1) return;
      const p = PORTALS[i];
      if (!p || !keys.includes(p.key)) return;
      e.preventDefault();
      router.push(p.href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, router]);

  const initials = (user?.name ?? '?')
    .split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');

  const firstName = (user?.name ?? '').split(/[\s._-]+/)[0] || 'there';
  const cap = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  return (
    <div className="gw">
      <header className="gw-tb">
        <div className="gw-brand">
          <div className="gw-logo" aria-hidden="true">317</div>
          <div>
            <div className="gw-bname">317 Eco System</div>
            <div className="gw-bsub">LBS Garage Door</div>
          </div>
        </div>

        <button className="gw-search" type="button"
                onClick={() => router.push('/portal/search')}>
          <FiSearch size={15} aria-hidden="true" />
          Search jobs, technicians, invoices…
          <span className="gw-kbd">⌘K</span>
        </button>

        <div className="gw-tbr">
          <button className="gw-ib" type="button"
                  onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <FiSun size={16} /> : <FiMoon size={16} />}
          </button>
          <button className="gw-ib" type="button" aria-label="Notifications">
            <FiBell size={16} />
          </button>
          <div className="gw-av" title={user?.name ?? ''}>{initials}</div>
          <button className="gw-ib" type="button" onClick={logout} aria-label="Sign out">
            <FiLogOut size={16} />
          </button>
        </div>
      </header>

      {keys.length === 0 ? (
        <div className="gw-noaccess">
          <h2>No portals assigned yet</h2>
          <p>
            You're signed in as <strong>{user?.name}</strong>, and your account is active —
            it just doesn't have access to a portal yet. Ask an administrator to assign one.
          </p>
        </div>
      ) : (
        <div className="gw-pg">
          <section className="gw-hero">
            <h1>{now ? greeting(now) : 'Welcome'}, {cap}</h1>
            <p>Here's where the business stands today.</p>
          </section>

          <section className="gw-kpis" aria-label="Business summary">
            <Kpi label="Revenue today" />
            <Kpi label="Jobs closed" />
            <Kpi label="Needs attention" />
            <Kpi label="Inbound stock" note="Warehouse opens Q4" />
          </section>

          <section className="gw-ports" aria-label="Portals">
            {PORTALS.map((p, i) => {
              const allowed = keys.includes(p.key);
              const cls = `gw-pc is-${p.key}${!allowed && !p.soon ? ' is-locked' : ''}`;

              const body = (
                <>
                  <div className="gw-pc-top">
                    <div className="gw-pc-ico"><Glyph k={p.key} /></div>
                    <span className={`gw-pc-tag${allowed ? ' on' : ''}`}>
                      {allowed ? '● Live' : p.soon ? 'Opening soon' : 'No access'}
                    </span>
                    <h2 className="gw-pc-nm">{p.name}</h2>
                    <p className="gw-pc-ds">{p.blurb}</p>
                  </div>

                  <div className="gw-pc-sig">
                    {p.signals.map((label, n) => (
                      <div key={label}>
                        <div className={`gw-sig-v pending${n === 0 ? ' acc' : ''}`}>—</div>
                        <div className="gw-sig-l">{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="gw-pc-prog">
                    <div className="gw-prog-t">
                      <span>{p.soon ? 'Phase 1 build' : 'Awaiting data'}</span>
                      <span>{p.soon ? 'Design' : '—'}</span>
                    </div>
                    <div className="gw-prog"><i style={{ width: p.soon ? '18%' : '0%' }} /></div>
                  </div>

                  <div className="gw-pc-act">
                    {allowed ? (
                      <span className="gw-btn">Open {p.name} <FiArrowRight size={14} /></span>
                    ) : p.soon ? (
                      <span className="gw-btn ghost">Opening Q4 2026</span>
                    ) : (
                      <span className="gw-btn ghost">Ask an administrator</span>
                    )}
                  </div>
                </>
              );

              return allowed
                ? <Link href={p.href} className={cls} key={p.key} title={`Open ${p.name} (⌘${i + 1})`}>{body}</Link>
                : <div className={cls} key={p.key} aria-disabled="true">{body}</div>;
            })}
          </section>

          <section className="gw-low">
            <div className="gw-pan">
              <div className="gw-pan-h"><span className="gw-pan-t">Needs attention</span></div>
              <div className="gw-pan-b">
                <div className="gw-empty">
                  <strong>Nothing to show yet</strong>
                  Open discrepancies, unreconciled transactions and overdue approvals
                  will appear here once the summary endpoints are connected.
                </div>
              </div>
            </div>

            <div className="gw-pan">
              <div className="gw-pan-h"><span className="gw-pan-t">Jump back in</span></div>
              <div className="gw-qa">
                {keys.includes('crm') && (
                  <Link className="gw-qa-i" href="/tables"><span className="gw-chip crm">CRM</span><span className="gw-qa-l">Jobs table</span></Link>
                )}
                {keys.includes('crm') && (
                  <Link className="gw-qa-i" href="/balance-report"><span className="gw-chip crm">CRM</span><span className="gw-qa-l">Balance report</span></Link>
                )}
                {keys.includes('fin') && (
                  <Link className="gw-qa-i" href="/portal/ledger"><span className="gw-chip fin">Finance</span><span className="gw-qa-l">Ledgers</span></Link>
                )}
                {keys.includes('fin') && (
                  <Link className="gw-qa-i" href="/portal/tasks"><span className="gw-chip fin">Finance</span><span className="gw-qa-l">Task board</span></Link>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
