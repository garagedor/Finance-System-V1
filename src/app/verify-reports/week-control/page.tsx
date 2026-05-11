'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FiArrowLeft, FiCalendar, FiLock, FiUnlock, FiPlay, FiUsers,
  FiClock, FiCheck, FiAlertTriangle,
} from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import EmptyState from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { formatDisplayDate } from '../../utils/jobUtils';
import '../../balance-report/styles.css';

type CurrentWeek = {
  current_local_time: string;
  week_start: string;
  week_end: string;
  opens_at: string;
  open_threshold_local: string;
  allowed: boolean;
  is_locked: boolean;
  open_hour: number;
  open_minute: number;
};

type WeekLock = { week_start: string; locked_at: string; locked_by: string | null; note: string | null };

type StateResponse = {
  currentWeek: CurrentWeek | null;
  locks: WeekLock[];
  weeks: string[];
};

export default function WeekControlPage() {
  const { user } = useAuth();
  const [state, setState] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Editable open-time
  const [hour, setHour] = useState<number>(20);
  const [minute, setMinute] = useState<number>(0);

  // Force-open failures (after running force-open-all)
  const [failures, setFailures] = useState<{ user_id: string; full_name: string | null; reason: string }[]>([]);

  // Selected week for lock/unlock dropdown
  const [selectedWeek, setSelectedWeek] = useState<string>('');

  const load = () => {
    setLoading(true);
    setError(null);
    fetch('/api/verify/week/state')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
        return j as StateResponse;
      })
      .then((j) => {
        setState(j);
        if (j.currentWeek) {
          setHour(j.currentWeek.open_hour ?? 20);
          setMinute(j.currentWeek.open_minute ?? 0);
        }
        if (j.weeks.length > 0 && !selectedWeek) setSelectedWeek(j.weeks[0]);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!user || user.type !== 'admin') {
    return (
      <div className="flex h-[60vh] items-center justify-center px-6">
        <EmptyState size="lg" title="Access Denied" message="Admin privileges required for week control." />
      </div>
    );
  }

  const flash = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500);
  };

  const callAction = async (action: string, body: any = {}) => {
    setBusy(action);
    try {
      const res = await fetch('/api/verify/week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      return j.data;
    } finally {
      setBusy(null);
    }
  };

  const onOpenNext = async () => {
    try {
      const data = await callAction('open-next', { force: true });
      flash('ok', `Opened ${data?.created ?? 0} new weekly report(s)`);
      load();
    } catch (e: any) { flash('err', e?.message || 'Failed to open reports'); }
  };

  const onForceOpenAll = async () => {
    try {
      setFailures([]);
      const data = await callAction('force-open-all');
      setFailures(data?.failures || []);
      flash('ok',
        `Reports opened for all active users — ${data?.created ?? 0} new, ${data?.already_open ?? 0} already open` +
        (data?.failures?.length ? ` (${data.failures.length} skipped)` : '')
      );
      load();
    } catch (e: any) { flash('err', e?.message || 'Failed to force-open reports'); }
  };

  const onCloseCurrent = async () => {
    try {
      const data = await callAction('close');
      flash('ok', data?.already_locked
        ? 'This week was already closed.'
        : `Week ${data?.week_start} closed.`);
      load();
    } catch (e: any) { flash('err', e?.message || 'Failed to close week'); }
  };

  const onReopenCurrent = async () => {
    try {
      const data = await callAction('reopen');
      flash('ok', `Week ${data?.week_start} reopened.`);
      load();
    } catch (e: any) { flash('err', e?.message || 'Failed to reopen week'); }
  };

  const onLockWeek = async (mode: 'close' | 'reopen', week: string) => {
    if (!week) { flash('err', 'Pick a week first'); return; }
    try {
      await callAction(mode, { week_start: week });
      flash('ok', `Week ${week} ${mode === 'close' ? 'locked' : 'reopened'}`);
      load();
    } catch (e: any) { flash('err', e?.message || `Failed to ${mode}`); }
  };

  const onSaveOpenTime = async () => {
    setBusy('open-time');
    try {
      const res = await fetch('/api/verify/week', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open_hour: hour, open_minute: minute }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      flash('ok', 'Open time updated');
      load();
    } catch (e: any) { flash('err', e?.message || 'Could not save open time'); }
    finally { setBusy(null); }
  };

  const cw = state?.currentWeek;
  const isLocked = cw?.is_locked === true;
  const statusLabel = isLocked ? 'Closed' : cw?.allowed ? 'Open' : 'Scheduled';
  const statusColor = isLocked ? '#f87171' : cw?.allowed ? '#34d399' : '#fbbf24';

  const lockedSet = useMemo(() => new Set((state?.locks || []).map((l) => l.week_start)), [state]);
  const timeDirty = cw ? (hour !== cw.open_hour || minute !== cw.open_minute) : false;

  return (
    <main className="balance-page">
      <div className="content">
        <header className="bp-header animate-fade-up">
          <div className="bp-header-left">
            <Link
              href="/verify-reports"
              className="pmr-clear-btn"
              style={{ textDecoration: 'none', marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}
            >
              <FiArrowLeft size={14} />
              <span>Back to reports</span>
            </Link>
            <p className="bp-kicker">Verification</p>
            <h1 className="bp-title">Week Control</h1>
            <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
              Open new weeks, lock or reopen any week, and configure when reports auto-open. Mirrors the Lovable Settings page — actions run through the same edge functions.
            </p>
          </div>
        </header>

        {toast && (
          <div
            className="panel animate-fade-up"
            style={{
              padding: 12, marginBottom: 12,
              borderColor: toast.kind === 'ok' ? 'rgba(52,211,153,0.4)' : 'rgba(239,68,68,0.4)',
              color: toast.kind === 'ok' ? '#86efac' : '#fca5a5',
              fontSize: 13,
            }}
          >
            {toast.kind === 'ok' ? <FiCheck style={{ verticalAlign: 'middle', marginRight: 6 }} /> : <FiAlertTriangle style={{ verticalAlign: 'middle', marginRight: 6 }} />}
            {toast.text}
          </div>
        )}

        {error && (
          <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'rgba(239,68,68,0.4)' }}>
            <pre style={{ color: '#f87171', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, position: 'relative' }}>
          {loading && !state && <LoadingOverlay message="Loading week state..." />}

          {/* Current week status */}
          <div className="panel animate-fade-up" style={{ padding: 16 }}>
            <p className="bp-section-kicker"><FiCalendar style={{ verticalAlign: 'middle', marginRight: 6 }} />Current week</p>
            <h3 style={{ marginTop: 4 }}>
              {cw ? `${formatDisplayDate(cw.week_start)} → ${formatDisplayDate(cw.week_end)}` : '—'}
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ ...pillStyle(statusColor), fontWeight: 600 }}>{statusLabel}</span>
              {cw && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  Auto-opens at {String(cw.open_hour).padStart(2, '0')}:{String(cw.open_minute).padStart(2, '0')} (Indiana)
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button
                className="pmr-clear-btn"
                onClick={onCloseCurrent}
                disabled={busy !== null || isLocked}
                title={isLocked ? 'Already locked' : 'Lock the current week'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <FiLock size={13} /><span>Close current week</span>
              </button>
              <button
                className="pmr-clear-btn"
                onClick={onReopenCurrent}
                disabled={busy !== null || !isLocked}
                title={!isLocked ? 'Not locked' : 'Reopen the current week'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <FiUnlock size={13} /><span>Reopen current week</span>
              </button>
            </div>
          </div>

          {/* Open new reports */}
          <div className="panel animate-fade-up" style={{ padding: 16 }}>
            <p className="bp-section-kicker"><FiPlay style={{ verticalAlign: 'middle', marginRight: 6 }} />Open new reports</p>
            <h3 style={{ marginTop: 4 }}>Create draft reports for techs</h3>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              Auto-runs every Sunday at the configured open-time. Use these to trigger it manually.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <button
                className="pmr-clear-btn"
                onClick={onOpenNext}
                disabled={busy !== null}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
              >
                <FiPlay size={13} /><span>Open next week (force)</span>
              </button>
              <button
                className="pmr-clear-btn"
                onClick={onForceOpenAll}
                disabled={busy !== null}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
              >
                <FiUsers size={13} /><span>Force-open for all active users</span>
              </button>
            </div>
            {failures.length > 0 && (
              <div style={{ marginTop: 12, padding: 8, borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <p style={{ fontSize: 11, color: '#fca5a5', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>{failures.length} skipped</p>
                {failures.slice(0, 6).map((f) => (
                  <div key={f.user_id} style={{ fontSize: 12, color: '#cbd5e1' }}>
                    {f.full_name || f.user_id} — <span style={{ color: '#94a3b8' }}>{f.reason}</span>
                  </div>
                ))}
                {failures.length > 6 && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>+ {failures.length - 6} more</div>
                )}
              </div>
            )}
          </div>

          {/* Open-time config */}
          <div className="panel animate-fade-up" style={{ padding: 16 }}>
            <p className="bp-section-kicker"><FiClock style={{ verticalAlign: 'middle', marginRight: 6 }} />Auto-open time</p>
            <h3 style={{ marginTop: 4 }}>When new reports open each Sunday</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input
                type="number" min={0} max={23}
                value={hour}
                onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                style={inputStyle}
              />
              <span style={{ color: '#64748b', fontSize: 16, fontWeight: 600 }}>:</span>
              <input
                type="number" min={0} max={59}
                value={minute}
                onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                style={inputStyle}
              />
              <span style={{ fontSize: 11, color: '#64748b' }}>Indiana time</span>
              <button
                className="pmr-clear-btn"
                onClick={onSaveOpenTime}
                disabled={!timeDirty || busy !== null}
                style={{ marginLeft: 'auto', opacity: timeDirty ? 1 : 0.5 }}
              >
                Save
              </button>
            </div>
          </div>

          {/* Lock / unlock arbitrary weeks */}
          <div className="panel animate-fade-up" style={{ padding: 16 }}>
            <p className="bp-section-kicker"><FiLock style={{ verticalAlign: 'middle', marginRight: 6 }} />Lock any week</p>
            <h3 style={{ marginTop: 4 }}>Pick a week and lock or reopen it</h3>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                style={{ ...inputStyle, minWidth: 160, flex: 1 }}
              >
                {(state?.weeks || []).map((w) => (
                  <option key={w} value={w}>
                    {formatDisplayDate(w)}{lockedSet.has(w) ? ' · LOCKED' : ''}
                  </option>
                ))}
              </select>
              <button
                className="pmr-clear-btn"
                onClick={() => onLockWeek('close', selectedWeek)}
                disabled={busy !== null || !selectedWeek || lockedSet.has(selectedWeek)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <FiLock size={13} /><span>Lock</span>
              </button>
              <button
                className="pmr-clear-btn"
                onClick={() => onLockWeek('reopen', selectedWeek)}
                disabled={busy !== null || !selectedWeek || !lockedSet.has(selectedWeek)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <FiUnlock size={13} /><span>Reopen</span>
              </button>
            </div>
            {state && state.locks.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                  Currently locked
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {state.locks.map((l) => (
                    <div key={l.week_start} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
                      <span style={{ ...pillStyle('#f87171'), padding: '2px 8px' }}>{formatDisplayDate(l.week_start)}</span>
                      <button
                        onClick={() => onLockWeek('reopen', l.week_start)}
                        disabled={busy !== null}
                        style={{
                          background: 'transparent', border: 'none', color: '#a5b4fc',
                          fontSize: 12, cursor: 'pointer', padding: 0,
                        }}
                      >
                        Quick unlock
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13,
  background: 'rgba(15,23,42,0.5)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, outline: 'none',
  width: 64, textAlign: 'center',
};

function pillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 999, fontSize: 11,
    background: color + '22', border: `1px solid ${color}55`, color,
    textTransform: 'uppercase', letterSpacing: 0.5,
  };
}
