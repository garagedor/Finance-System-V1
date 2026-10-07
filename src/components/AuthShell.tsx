'use client';

/* ═══════════════════════════════════════════════════════════════════════════
   AuthShell — session context + chrome selection.

   Design 360 S2: the authentication logic below is UNCHANGED — same session
   restore, same global 401 interceptor, same login/logout. What changed is
   that the hand-rolled sidebar and top bar have been replaced by
   <EcosystemShell>, which renders navigation from a grouped business-category
   config and applies portal identity. Page content renders inside it untouched.

   `navLinks` is still accepted so src/app/layout.tsx needs no change; the
   navigation model now lives in src/components/shell/nav-config.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import LoginPage from './LoginPage';
import EcosystemShell from './shell/EcosystemShell';
import type { AuthUser } from '@/types/user';

// Browser-only (TTS/audio/streaming) and not needed for first paint.
const LiveAssistant = dynamic(() => import('@/components/live/LiveAssistant'), { ssr: false });

type NavLink = { href: string; label: string; adminOnly?: boolean; permission?: string };

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

/** Routes that render with NO chrome — printable documents, and the gateway,
 *  which is the ecosystem shell rather than a page inside a portal.
 *
 *  '/' is matched EXACTLY. These are prefix matches, and a prefix of '/'
 *  matches every route in the application. */
const BARE_PREFIXES = ['/payout-statement'];
const BARE_EXACT = ['/'];

export function AuthShell({ children }: { children: React.ReactNode; navLinks?: NavLink[] }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try { setUser(JSON.parse(stored)); }
      catch { localStorage.removeItem('user'); }
    }
  }, []);

  // Global fetch interceptor for 401 — unchanged behaviour.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === 'string'
        ? args[0]
        : (args[0] instanceof Request ? args[0].url : '');
      if (response.status === 401 && !url.includes('/api/logout') && !url.includes('/api/login')) {
        console.warn('Session expired or unauthorized. Logging out.');
        setUser(null);
        localStorage.removeItem('user');
      }
      return response;
    };

    return () => { window.fetch = originalFetch; };
  }, []);

  const login = (u: AuthUser) => {
    setUser(u);
    localStorage.setItem('user', JSON.stringify(u));
  };

  const logout = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); }
    catch (e) { console.error('Logout failed:', e); }
    setUser(null);
    localStorage.removeItem('user');
  };

  if (!user) return <LoginPage onLogin={login} />;

  if (BARE_EXACT.includes(pathname ?? '') || BARE_PREFIXES.some((r) => pathname?.startsWith(r))) {
    return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
  }

  const canUseAssistant =
    user.type === 'admin' || (user.permissions ?? []).some((p) => p.startsWith('system:ai'));

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <EcosystemShell user={user} onLogout={logout}>
        {children}
      </EcosystemShell>
      {/* Global voice assistant — persists across route changes. */}
      {canUseAssistant && <LiveAssistant />}
    </AuthContext.Provider>
  );
}
