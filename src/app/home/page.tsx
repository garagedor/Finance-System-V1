'use client';

/* ═══════════════════════════════════════════════════════════════════════════
   Main Gateway — the ecosystem control center.

   SCOPE NOTE (Design 360): this is a NEW route. It reads the session that
   already exists and renders links. It performs no mutation, calls no new
   API, and changes no CRM or Finance behaviour. Removing this folder removes
   the feature completely.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FiBriefcase, FiPieChart, FiPackage, FiArrowRight, FiSun, FiMoon,
  FiLogOut, FiAlertTriangle,
} from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import '@/styles/design-system.css';
import './gateway.css';

type PortalKey = 'crm' | 'fin' | 'whs';

interface PortalDef {
  key: PortalKey;
  index: string;
  name: string;
  href: string;
  desc: string;
  domains: string[];
  /** Any one of these grants access. */
  anyOf: string[];
  soon?: boolean;
}

const PORTALS: PortalDef[] = [
  {
    key: 'crm',
    index: 'PORTAL 01',
    name: 'CRM',
    href: '/',
    desc: 'Field operations: dispatch, job records, technician performance and the customer history behind them.',
    domains: ['jobs', 'technicians', 'operations', 'customers'],
    anyOf: ['crm:'],
  },
  {
    key: 'fin',
    index: 'PORTAL 02',
    name: 'Finance Portal',
    href: '/portal/dashboard',
    desc: 'Financial control: running ledgers, balances, payouts, disputes and the reports built on them.',
    domains: ['ledger', 'balances', 'reports', 'control'],
    anyOf: ['finance:'],
  },
  {
    key: 'whs',
    index: 'PORTAL 03',
    name: 'Warehouse Management',
    href: '/warehouse',
    desc: 'Miami distribution: purchasing through customs to counted stock on the shelf.',
    domains: ['inventory', 'purchasing', 'containers', 'receiving'],
    anyOf: ['warehouse:'],
    soon: true,
  },
];

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

  // Render time only after mount so server and client markup agree.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lbs-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch { /* private mode — keep the default */ }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('lbs-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const perms = useMemo(() => user?.permissions ?? [], [user]);
  const isAdmin = user?.type === 'admin';

  const access = useMemo(() => {
    const can = (p: PortalDef) =>
      !p.soon && (isAdmin || perms.some((k) => p.anyOf.some((pre) => k.startsWith(pre))));
    return Object.fromEntries(PORTALS.map((p) => [p.key, can(p)])) as Record<PortalKey, boolean>;
  }, [perms, isAdmin]);

  // ⌘1 / ⌘2 / ⌘3 — fast portal switching.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i === -1) return;
      const p = PORTALS[i];
      if (!p || !access[p.key]) return;
      e.preventDefault();
      router.push(p.href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [access, router]);

  const initials = (user?.name ?? '?')
    .split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');

  const roleLabel =
    user?.type === 'admin' ? 'Administrator'
    : user?.type === 'location-manager' ? 'Location Manager'
    : user?.type === 'bookkeeper' ? 'Bookkeeper'
    : user?.type === 'office' ? 'Office'
    : 'Team member';

  return (
    <div className="gw">
      <header className="gw-topbar">
        <div className="gw-topbar-inner">
          <div className="gw-mark">
            <div className="gw-mark-glyph" aria-hidden="true">LBS</div>
            <span className="gw-mark-text">Operations Ecosystem</span>
          </div>

          <div className="gw-status" role="status" aria-label="System status">
            <span className="gw-stat"><i className="gw-dot is-live" />All systems normal</span>
            <span className="gw-stat"><i className="gw-dot" />Database</span>
            <span className="gw-stat"><i className="gw-dot" />Integrations</span>
            <span className="gw-stat">
              {now ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
            </span>
          </div>

          <button
            className="gw-iconbtn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title="Toggle theme"
          >
            {theme === 'dark' ? <FiSun size={14} /> : <FiMoon size={14} />}
          </button>

          <div className="gw-user">
            <div className="gw-avatar" aria-hidden="true">{initials}</div>
            <div>
              <div className="gw-user-name">{user?.name ?? 'Signed out'}</div>
              <div className="gw-user-role">{roleLabel}</div>
            </div>
            <button className="gw-iconbtn" onClick={logout} aria-label="Sign out" title="Sign out">
              <FiLogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="gw-inner">
        <section className="gw-greet">
          <p className="gw-greet-kicker">
            {now ? now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : ' '}
          </p>
          <h1 className="gw-greet-title">
            {now ? greeting(now) : 'Welcome'}, {user?.name ?? 'there'}.
          </h1>
          <p className="gw-greet-sub">
            Choose a portal to work in. Everything runs on one sign-in, and your access is
            already applied below.
          </p>
        </section>

        <section className="gw-portals" aria-label="Portals">
          {PORTALS.map((p, i) => {
            const allowed = access[p.key];
            const Icon = p.key === 'crm' ? FiBriefcase : p.key === 'fin' ? FiPieChart : FiPackage;
            const cls = `gw-portal is-${p.key}${p.soon ? ' is-soon' : ''}${!allowed && !p.soon ? ' is-locked' : ''}`;

            const inner = (
              <>
                <div className="gw-portal-head">
                  <Icon size={15} style={{ color: 'var(--accent)' }} aria-hidden="true" />
                  <span className="gw-portal-idx">{p.index}</span>
                  <span className="gw-portal-state">
                    {p.soon ? (
                      <><i className="gw-dot is-idle" />In development</>
                    ) : allowed ? (
                      <><i className="gw-dot" />Available</>
                    ) : (
                      <><i className="gw-dot is-idle" />No access</>
                    )}
                  </span>
                </div>

                <div className="gw-portal-body">
                  <h2 className="gw-portal-name">{p.name}</h2>
                  <p className="gw-portal-desc">{p.desc}</p>
                  <div className="gw-domains">
                    {p.domains.map((d) => <span className="gw-domain" key={d}>{d}</span>)}
                  </div>
                </div>

                <div className="gw-portal-foot">
                  {p.soon ? (
                    <span className="gw-metric-lbl">Phase 1 · inbound supply chain</span>
                  ) : (
                    <span className="gw-metric-lbl">
                      {allowed ? 'Ready' : 'Ask an administrator for access'}
                    </span>
                  )}
                  {allowed && (
                    <span className="gw-portal-go">
                      Open <kbd>⌘{i + 1}</kbd> <FiArrowRight size={12} />
                    </span>
                  )}
                </div>
              </>
            );

            return allowed
              ? <Link href={p.href} className={cls} key={p.key}>{inner}</Link>
              : <div className={cls} key={p.key} aria-disabled="true">{inner}</div>;
          })}
        </section>

        <section className="gw-lower">
          <div className="gw-panel">
            <div className="gw-panel-head">
              <FiAlertTriangle size={13} style={{ color: 'var(--ds-ink-3)' }} aria-hidden="true" />
              <span className="gw-panel-title">Needs attention</span>
              <span className="gw-panel-count">—</span>
            </div>
            <div className="gw-panel-body">
              <div className="gw-empty">
                <span className="gw-empty-glyph" aria-hidden="true">[ ]</span>
                Attention items are not wired up yet. This panel will surface open
                discrepancies, unreconciled transactions and overdue approvals.
              </div>
            </div>
          </div>

          <div className="gw-panel">
            <div className="gw-panel-head"><span className="gw-panel-title">Quick actions</span></div>
            <div className="gw-actions">
              {access.crm && (
                <Link href="/tables" className="gw-action">
                  <span className="gw-action-lbl">Jobs table</span>
                  <span className="gw-action-hint">CRM</span>
                </Link>
              )}
              {access.crm && (
                <Link href="/balance-report" className="gw-action">
                  <span className="gw-action-lbl">Balance report</span>
                  <span className="gw-action-hint">CRM</span>
                </Link>
              )}
              {access.fin && (
                <Link href="/portal/ledger" className="gw-action">
                  <span className="gw-action-lbl">Ledgers</span>
                  <span className="gw-action-hint">Finance</span>
                </Link>
              )}
              {access.fin && (
                <Link href="/portal/tasks" className="gw-action">
                  <span className="gw-action-lbl">Task board</span>
                  <span className="gw-action-hint">Finance</span>
                </Link>
              )}
            </div>
          </div>
        </section>

        <p className="gw-foot">
          LBS Operations Ecosystem · one sign-in, three portals · signed in as {user?.name ?? '—'}
        </p>
      </div>
    </div>
  );
}
