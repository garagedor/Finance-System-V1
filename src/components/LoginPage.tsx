'use client';

/* ═══════════════════════════════════════════════════════════════════════════
   Login — Design 360 v2.

   SCOPE NOTE: the authentication logic below is UNCHANGED — same endpoint,
   same 2FA flow, same rate-limit handling, same payload. What is new is the
   presentation and the access-granted reveal, which runs AFTER a successful
   response and before the session is handed to the app. It grants nothing:
   it only shows the caller what the server already decided.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../types/user';
import { PORTALS, grantedPortals, type PortalKey } from '@/config/portals';
import '@/styles/design-system.css';
import './LoginPage.css';

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

const ICONS: Record<PortalKey, React.ReactNode> = {
  crm: (<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>),
  fin: (<><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  whs: (<><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5M12 22V12" /></>),
};

function PortalGlyph({ k, size = 20 }: { k: PortalKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {ICONS[k]}
    </svg>
  );
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutTime, setLockoutTime] = useState<number | null>(null);
  const [lockoutMs, setLockoutMs] = useState(0);

  /** Set once the server has accepted the credentials; drives the reveal. */
  const [granted, setGranted] = useState<AuthUser | null>(null);
  const handedOff = useRef(false);

  // Live lockout countdown — unchanged behaviour.
  useEffect(() => {
    if (!lockoutTime) { setLockoutMs(0); return; }
    const tick = () => {
      const remaining = Math.max(0, lockoutTime - Date.now());
      setLockoutMs(remaining);
      if (remaining <= 0) { setLockoutTime(null); setError(''); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutTime]);

  const lockoutLabel = (() => {
    if (!lockoutMs) return null;
    const total = Math.ceil(lockoutMs / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  })();

  /** Hand the session to the app. Idempotent — the timer and a skip can race. */
  const complete = useCallback(() => {
    if (handedOff.current || !granted) return;
    handedOff.current = true;
    onLogin(granted);
  }, [granted, onLogin]);

  // Reveal runs, then routes. Skippable by click or key; shortened when the
  // viewer prefers reduced motion.
  useEffect(() => {
    if (!granted) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const hold = reduced ? 700 : 2400;
    const timer = setTimeout(complete, hold);
    const skip = () => complete();
    window.addEventListener('keydown', skip);
    window.addEventListener('click', skip);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('click', skip);
    };
  }, [granted, complete]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockoutTime && Date.now() < lockoutTime) {
      const mins = Math.ceil((lockoutTime - Date.now()) / 60000);
      setError(`Too many attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`);
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password, mfa_code: mfaRequired ? mfaCode : undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.mfa_required) {
          setMfaRequired(true);
          setError(mfaRequired ? (data.error || 'That code was not accepted. Try the next one.') : '');
          return;
        }
        setError(
          res.status === 401
            ? "That username and password don't match."
            : data.error || 'Something went wrong. Please try again.',
        );
        if (res.status === 429) {
          setLockoutTime(Date.now() + 5 * 60 * 1000);
        }
        return;
      }

      setName(''); setPassword(''); setMfaCode('');
      setMfaRequired(false); setLockoutTime(null);
      setGranted(data as AuthUser);      // → reveal, then onLogin
    } catch (err) {
      console.error('Login error:', err);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Access granted ──────────────────────────────────────────────────────
  if (granted) {
    const keys = grantedPortals(granted.permissions, granted.type);
    const count = keys.length;
    return (
      <div className="ag" role="status" aria-live="polite">
        <div className="ag-seal" aria-hidden="true">
          <svg viewBox="0 0 72 72">
            <circle className="ag-ring" cx="36" cy="36" r="32" />
            <circle className="ag-arc" cx="36" cy="36" r="32"
                    transform="rotate(-90 36 36)" />
            <path className="ag-tick" d="M23 37.5 L32 46 L49.5 27" />
          </svg>
        </div>

        <div>
          <h1 className="ag-title">Access approved</h1>
          <p className="ag-sub">
            {count === 0
              ? `Signed in as ${granted.name}. No portals are assigned to you yet.`
              : `Welcome back, ${granted.name}. You have access to ${count} of 3 portals.`}
          </p>
        </div>

        <div className="ag-list">
          {PORTALS.map((p, i) => {
            const ok = keys.includes(p.key);
            const cls = `ag-item is-${p.key} ${ok ? 'is-granted' : 'is-denied'}`;
            return (
              <div
                key={p.key}
                className={cls}
                style={{ animationDelay: `${820 + i * 170}ms`, animationFillMode: 'forwards' }}
              >
                <span className="ag-ico"><PortalGlyph k={p.key} size={18} /></span>
                <span className="ag-name">{p.name}</span>
                <span className={`ag-state ${ok ? 'on' : p.soon ? 'soon' : 'off'}`}>
                  {ok ? <>✓ Granted</> : p.soon ? <>Opening soon</> : <>Not assigned</>}
                </span>
              </div>
            );
          })}
        </div>

        <button className="ag-skip" onClick={complete} type="button">
          Continue now
        </button>
      </div>
    );
  }

  // ── Sign in ─────────────────────────────────────────────────────────────
  const disabled = loading || !!lockoutLabel;

  return (
    <div className="lg-root">
      <div className="lg-left">
        <div className="lg-box">
          <div className="lg-brand">
            <div className="lg-logo" aria-hidden="true">317</div>
            <div>
              <div className="lg-bname">317 Eco System</div>
              <div className="lg-bsub">LBS Garage Door</div>
            </div>
          </div>

          <h1 className="lg-h">Welcome back</h1>
          <p className="lg-p">
            {mfaRequired
              ? 'Enter the six-digit code from your authenticator app.'
              : 'Sign in to reach CRM, Finance and Warehouse.'}
          </p>

          <form onSubmit={handleLogin}>
            {!mfaRequired ? (
              <>
                <div className="lg-field">
                  <label htmlFor="lg-name">Username</label>
                  <input id="lg-name" className={`lg-input${error ? ' is-err' : ''}`}
                         value={name} onChange={(e) => setName(e.target.value)}
                         autoComplete="username" autoFocus disabled={disabled} required />
                </div>
                <div className="lg-field">
                  <label htmlFor="lg-pw">Password</label>
                  <input id="lg-pw" type="password" className={`lg-input${error ? ' is-err' : ''}`}
                         value={password} onChange={(e) => setPassword(e.target.value)}
                         autoComplete="current-password" disabled={disabled} required />
                </div>
              </>
            ) : (
              <div className="lg-field">
                <label htmlFor="lg-mfa">Authentication code</label>
                <input id="lg-mfa" className={`lg-input${error ? ' is-err' : ''}`}
                       value={mfaCode} onChange={(e) => setMfaCode(e.target.value)}
                       inputMode="numeric" autoComplete="one-time-code"
                       maxLength={8} autoFocus disabled={disabled} required />
              </div>
            )}

            {error && (
              <div className="lg-err" role="alert">
                <span aria-hidden="true">⚠</span>
                <span>{lockoutLabel ? `Too many attempts. Try again in ${lockoutLabel}.` : error}</span>
              </div>
            )}

            <div style={{ marginTop: 'var(--ds-space-5)' }}>
              <button className="lg-btn" type="submit" disabled={disabled}>
                {loading ? <><span className="lg-spin" aria-hidden="true" /> Signing you in…</>
                         : mfaRequired ? 'Verify code' : 'Sign in'}
              </button>
            </div>
          </form>

          {mfaRequired ? (
            <button className="lg-link" type="button"
                    onClick={() => { setMfaRequired(false); setMfaCode(''); setError(''); }}>
              Use a different account
            </button>
          ) : (
            <button className="lg-link" type="button"
                    onClick={() => setError('Ask an administrator to reset your password.')}>
              Forgot your password?
            </button>
          )}

          <p className="lg-foot">Protected by two-factor authentication where enabled.</p>
        </div>
      </div>

      <aside className="lg-right" aria-label="What you can reach">
        <p className="lg-rt">One sign-in. Three portals.</p>
        {PORTALS.map((p) => (
          <div className="lg-pcard" key={p.key}>
            <div className={`lg-pico is-${p.key}`} style={{ background: `var(--ds-${p.key})` }}>
              <PortalGlyph k={p.key} size={22} />
            </div>
            <div>
              <p className="lg-pn">{p.name}</p>
              <p className="lg-pd">{p.blurb}</p>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
