'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FiLogOut, FiUser, FiHome, FiGrid, FiBarChart2,
  FiDollarSign, FiFileText, FiChevronLeft, FiChevronRight, FiMenu,
} from 'react-icons/fi';
import LoginPage from './LoginPage';
import type { AuthUser } from '@/types/user';

type NavLink = { href: string; label: string };

type AuthContextValue = {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthShell');
  return ctx;
};

const NAV_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  '/': FiHome,
  '/tables': FiGrid,
  '/stats': FiBarChart2,
  '/balance-report': FiDollarSign,
  '/report': FiFileText,
};

const PAGE_TITLES: Record<string, { title: string; section: string }> = {
  '/':                { title: 'Dashboard',      section: 'Overview' },
  '/tables':          { title: 'Tables',         section: 'Data' },
  '/stats':           { title: 'Statistics',     section: 'Analytics' },
  '/balance-report':  { title: 'Balance Report', section: 'Reports' },
  '/report':          { title: 'Reports',        section: 'Reports' },
};

export function AuthShell({ children, navLinks }: { children: React.ReactNode; navLinks: NavLink[] }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem('user');
      }
    }
  }, []);

  // Global fetch interceptor to handle 401 Unauthorized responses
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);

      // If unauthorized, and not already trying to login/logout
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
      if (response.status === 401 && !url.includes('/api/logout') && !url.includes('/api/login')) {
        console.warn('Session expired or unauthorized. Logging out.');
        // Clear local state
        setUser(null);
        localStorage.removeItem('user');
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const login = (u: AuthUser) => {
    setUser(u);
    localStorage.setItem('user', JSON.stringify(u));
  };

  const logout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout failed:', e);
    }
    setUser(null);
    localStorage.removeItem('user');
  };

  if (!user) {
    return <LoginPage onLogin={login} />;
  }

  const roleLabel =
    user.type === 'admin' ? 'Admin' :
    user.type === 'office' ? 'Office' :
    user.type === 'location-manager' ? 'Location Mgr' :
    user.type ?? '';

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <div className="flex h-screen overflow-hidden" style={{ background: '#0a0f1c' }}>

        {/* Mobile overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* ── Sidebar ── */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
          style={{
            width: collapsed ? 64 : 240,
            background: '#0d1526',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}
        >
          {/* Brand */}
          <div
            className="flex h-14 flex-shrink-0 items-center gap-3 px-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/30">
              <svg width="16" height="16" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="22" height="19" rx="2" stroke="white" strokeWidth="1.8" fill="none"/>
                <line x1="3"  y1="9"  x2="25" y2="9"  stroke="white" strokeWidth="1.4"/>
                <line x1="3"  y1="14" x2="25" y2="14" stroke="white" strokeWidth="1.4"/>
                <line x1="3"  y1="19" x2="25" y2="19" stroke="white" strokeWidth="1.4"/>
                <line x1="11" y1="22" x2="11" y2="26" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="17" y1="22" x2="17" y2="26" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            {!collapsed && (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-bold leading-tight text-white">LBS Garage Door</span>
                <span className="text-[10px] uppercase tracking-widest leading-tight" style={{ color: '#475569' }}>Operations</span>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
            {navLinks.map((link) => {
              const Icon = NAV_ICONS[link.href] || FiGrid;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? link.label : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'text-indigo-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  style={
                    isActive
                      ? { background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }
                      : { border: '1px solid transparent' }
                  }
                >
                  <Icon size={17} className="flex-shrink-0" />
                  {!collapsed && <span className="truncate">{link.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* Collapse toggle — desktop only */}
          <div
            className="hidden lg:flex flex-shrink-0 items-center p-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
          >
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="flex w-full items-center justify-center rounded-xl p-2 transition-colors"
              style={{ color: '#475569' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
              onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <FiChevronRight size={16} /> : <FiChevronLeft size={16} />}
            </button>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

          {/* Topbar */}
          <header
            className="flex h-14 flex-shrink-0 items-center justify-between gap-3 px-5"
            style={{ background: '#0d1526', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            {/* Mobile hamburger */}
            <button
              className="flex items-center justify-center rounded-xl p-2 text-slate-400 transition-colors hover:text-slate-200 lg:hidden"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <FiMenu size={18} />
            </button>

            {/* Desktop: page breadcrumb */}
            <div className="hidden lg:flex flex-col leading-tight min-w-0">
              {PAGE_TITLES[pathname] && (
                <>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                    {PAGE_TITLES[pathname].section}
                  </span>
                  <span className="text-sm font-bold text-slate-200 truncate">
                    {PAGE_TITLES[pathname].title}
                  </span>
                </>
              )}
            </div>

            {/* User chip + logout */}
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-2.5 rounded-xl px-3 py-1.5"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <div
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'rgba(99,102,241,0.2)' }}
                >
                  <FiUser size={13} className="text-indigo-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold leading-tight text-white">{user.name}</span>
                  {user.type && (
                    <span className="text-[10px] font-medium uppercase leading-tight" style={{ color: '#475569' }}>
                      {roleLabel}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={logout}
                className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-slate-500 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
                title="Logout"
                aria-label="Logout"
              >
                <FiLogOut size={16} />
              </button>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-auto" style={{ background: '#0a0f1c' }}>
            {children}
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
