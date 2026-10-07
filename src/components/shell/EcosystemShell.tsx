'use client';

/* ═══════════════════════════════════════════════════════════════════════════
   Ecosystem shell — Design 360 S2.

   SCOPE NOTE: chrome only. This component renders the top bar, sidebar and
   portal identity around whatever page is already there. It reads the session
   for permissions and the pathname for the active portal, and renders
   `children` untouched. No API call, no mutation, no business logic.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  FiSearch, FiSun, FiMoon, FiBell, FiLogOut, FiMenu,
  FiChevronsLeft, FiChevronsRight, FiGrid,
} from 'react-icons/fi';
import type { AuthUser } from '@/types/user';
import type { PortalKey } from '@/config/portals';
import SidebarClocks from '@/components/SidebarClocks';
import {
  NAV_BY_PORTAL, PORTAL_LABEL, activeHref, portalForPath, visibleGroups,
} from './nav-config';
import '@/styles/design-system.css';
import './shell.css';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  office: 'Office',
  'location-manager': 'Location Manager',
  bookkeeper: 'Bookkeeper',
  simple: 'Team member',
};

const PORTAL_GLYPH: Record<PortalKey, React.ReactNode> = {
  crm: (<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>),
  fin: (<><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  whs: (<><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>),
};

export default function EcosystemShell({
  user,
  onLogout,
  children,
}: {
  user: AuthUser;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const portal = portalForPath(pathname);
  const isAdmin = user.type === 'admin';

  useEffect(() => {
    try {
      const t = localStorage.getItem('lbs-theme');
      if (t === 'light' || t === 'dark') setTheme(t);
      setCollapsed(localStorage.getItem('lbs-nav-collapsed') === '1');
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('lbs-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem('lbs-nav-collapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const groups = useMemo(
    () => visibleGroups(NAV_BY_PORTAL[portal], user.permissions, isAdmin),
    [portal, user.permissions, isAdmin],
  );
  const active = useMemo(() => activeHref(groups, pathname), [groups, pathname]);

  // ⌘K → search, ⌘\ → collapse. Both no-ops if the browser claims them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'k') { e.preventDefault(); router.push('/portal/search'); }
      if (e.key === '\\') { e.preventDefault(); setCollapsed((c) => !c); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const initials = (user.name ?? '?')
    .split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');

  const cls = [
    'sh', `is-${portal}`,
    collapsed ? 'is-collapsed' : '',
    mobileOpen ? 'is-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div className="sh-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />

      <aside className="sh-side" aria-label={`${PORTAL_LABEL[portal]} navigation`}>
        <Link href="/" className="sh-brand">
          <div className="sh-logo" aria-hidden="true">317</div>
          <div className="sh-brand-txt">
            <div className="sh-brand-n">317 Eco System</div>
            <div className="sh-brand-s">LBS Garage Door</div>
          </div>
        </Link>

        <Link href="/" className="sh-switch" title="Switch portal">
          <span className="sh-switch-ico">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {PORTAL_GLYPH[portal]}
            </svg>
          </span>
          <span className="sh-switch-t">
            <span className="sh-switch-l">Portal</span>
            <span className="sh-switch-n">{PORTAL_LABEL[portal]}</span>
          </span>
          <FiGrid size={14} style={{ color: 'var(--ds-ink-3)', flex: 'none' }} aria-hidden="true" />
        </Link>

        <nav className="sh-nav">
          {groups.map((g) => (
            <div className="sh-group" key={g.label}>
              <div className="sh-group-l">{g.label}</div>
              {g.items.map((it) => {
                const Icon = it.icon;
                const on = active === it.href;
                const itemCls = `sh-item${on ? ' is-active' : ''}${it.soon ? ' is-soon' : ''}`;
                if (it.soon) {
                  return (
                    <span className={itemCls} key={it.href} aria-disabled="true" title="Coming soon">
                      <Icon size={16} />
                      <span className="sh-item-txt">{it.label}</span>
                    </span>
                  );
                }
                return (
                  <Link className={itemCls} href={it.href} key={it.href}
                        title={collapsed ? it.label : undefined}
                        aria-current={on ? 'page' : undefined}>
                    <Icon size={16} />
                    <span className="sh-item-txt">{it.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Existing feature, preserved: world clocks for the field teams. */}
        <SidebarClocks collapsed={collapsed} />

        <div className="sh-side-foot">
          <button className="sh-collapse" type="button" onClick={() => setCollapsed((c) => !c)}
                  aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            {collapsed ? <FiChevronsRight size={14} /> : <><FiChevronsLeft size={14} /> Collapse</>}
          </button>
        </div>
      </aside>

      <div className="sh-main">
        <header className="sh-top">
          <button className="sh-ib sh-burger" type="button"
                  onClick={() => setMobileOpen((o) => !o)} aria-label="Open navigation">
            <FiMenu size={16} />
          </button>

          <button className="sh-search" type="button" onClick={() => router.push('/portal/search')}>
            <FiSearch size={14} aria-hidden="true" />
            <span className="sh-search-txt">Search jobs, technicians, invoices…</span>
            <span className="sh-kbd">⌘K</span>
          </button>

          <div className="sh-top-r">
            <span className="sh-status" title="All systems normal">
              <i className="sh-dot" aria-hidden="true" /> All systems normal
            </span>

            <button className="sh-ib" type="button"
                    onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                    aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? <FiSun size={15} /> : <FiMoon size={15} />}
            </button>

            <button className="sh-ib" type="button" aria-label="Notifications">
              <FiBell size={15} />
            </button>

            <div className="sh-user">
              <div className="sh-av" aria-hidden="true">{initials}</div>
              <div className="sh-user-t">
                <div className="sh-user-n">{user.name}</div>
                <div className="sh-user-r">{ROLE_LABEL[user.type ?? ''] ?? 'Team member'}</div>
              </div>
              <button className="sh-ib" type="button" onClick={onLogout} aria-label="Sign out">
                <FiLogOut size={15} />
              </button>
            </div>
          </div>
        </header>

        <main className="sh-content">{children}</main>
      </div>
    </div>
  );
}
