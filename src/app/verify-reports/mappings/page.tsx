'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FiArrowLeft, FiCheck, FiX, FiSearch } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import EmptyState from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import '../../balance-report/styles.css';

type SupabaseUser = { id: string; fullName: string; role: string | null };
type SupabaseArea = { id: string; name: string };
type TechMapping = { supabaseUserId: string; supabaseFullName: string; crmTechNames: string[] };
type AreaMapping = { supabaseAreaId: string; supabaseAreaName: string; crmLocationNames: string[] };

type MappingsResponse = {
  supabaseUsers: SupabaseUser[];
  supabaseAreas: SupabaseArea[];
  crmTechs: string[];
  crmLocations: string[];
  techMappings: TechMapping[];
  areaMappings: AreaMapping[];
};

export default function MappingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'techs' | 'areas'>('techs');
  const [data, setData] = useState<MappingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local edit state — keyed by supabase id. Lets the user pick multiple CRM
  // names before hitting Save.
  const [techDraft, setTechDraft] = useState<Record<string, string[]>>({});
  const [areaDraft, setAreaDraft] = useState<Record<string, string[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch('/api/verify/mappings')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
        return j as MappingsResponse;
      })
      .then((j) => {
        setData(j);
        // Seed drafts from server state.
        const t: Record<string, string[]> = {};
        j.techMappings.forEach((m) => { t[m.supabaseUserId] = [...m.crmTechNames]; });
        setTechDraft(t);
        const a: Record<string, string[]> = {};
        j.areaMappings.forEach((m) => { a[m.supabaseAreaId] = [...m.crmLocationNames]; });
        setAreaDraft(a);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (!user || user.type !== 'admin') {
    return (
      <div className="flex h-[60vh] items-center justify-center px-6">
        <EmptyState size="lg" title="Access Denied" message="Admin privileges required to manage mappings." />
      </div>
    );
  }

  const saveTech = async (u: SupabaseUser) => {
    setSavingId(u.id);
    try {
      const res = await fetch('/api/verify/mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'tech',
          supabaseUserId: u.id,
          supabaseFullName: u.fullName,
          crmTechNames: techDraft[u.id] || [],
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      setSavedFlash(u.id);
      setTimeout(() => setSavedFlash((prev) => (prev === u.id ? null : prev)), 1500);
    } catch (e: any) {
      alert(`Save failed: ${e?.message || e}`);
    } finally {
      setSavingId(null);
    }
  };

  const saveArea = async (a: SupabaseArea) => {
    setSavingId(a.id);
    try {
      const res = await fetch('/api/verify/mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'area',
          supabaseAreaId: a.id,
          supabaseAreaName: a.name,
          crmLocationNames: areaDraft[a.id] || [],
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      setSavedFlash(a.id);
      setTimeout(() => setSavedFlash((prev) => (prev === a.id ? null : prev)), 1500);
    } catch (e: any) {
      alert(`Save failed: ${e?.message || e}`);
    } finally {
      setSavingId(null);
    }
  };

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
            <h1 className="bp-title">Identity Mappings</h1>
            <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
              Reconcile names from the Lovable balance app (left) with how they appear in your CRM (right).
              When a Supabase user has at least one mapped CRM name, the verification compares against those names instead of doing an exact match.
            </p>
          </div>
        </header>

        {error && (
          <div className="panel" style={{ padding: 16, marginBottom: 12, borderColor: 'rgba(239,68,68,0.4)' }}>
            <p style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
              Couldn't load mappings
            </p>
            <pre style={{ color: '#f87171', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
          </div>
        )}

        <div className="bp-cv-tabs animate-fade-up" style={{ marginBottom: 12 }}>
          <button className={`bp-cv-tab ${tab === 'techs' ? 'active' : ''}`} onClick={() => setTab('techs')}>
            Technicians ({data?.supabaseUsers.length ?? 0})
          </button>
          <button className={`bp-cv-tab ${tab === 'areas' ? 'active' : ''}`} onClick={() => setTab('areas')}>
            Areas ({data?.supabaseAreas.length ?? 0})
          </button>
        </div>

        <div className="panel bp-table-panel animate-fade-up" style={{ position: 'relative' }}>
          {loading && !data && <LoadingOverlay message="Loading mappings..." />}

          {tab === 'techs' && data && (
            <TechMappingsTable
              users={data.supabaseUsers}
              crmTechs={data.crmTechs}
              draft={techDraft}
              setDraft={setTechDraft}
              onSave={saveTech}
              savingId={savingId}
              savedFlash={savedFlash}
            />
          )}

          {tab === 'areas' && data && (
            <AreaMappingsTable
              areas={data.supabaseAreas}
              crmLocations={data.crmLocations}
              draft={areaDraft}
              setDraft={setAreaDraft}
              onSave={saveArea}
              savingId={savingId}
              savedFlash={savedFlash}
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ─── TECH MAPPINGS ──────────────────────────────────────────────────────────

function TechMappingsTable({
  users, crmTechs, draft, setDraft, onSave, savingId, savedFlash,
}: {
  users: SupabaseUser[];
  crmTechs: string[];
  draft: Record<string, string[]>;
  setDraft: (fn: (prev: Record<string, string[]>) => Record<string, string[]>) => void;
  onSave: (u: SupabaseUser) => void;
  savingId: string | null;
  savedFlash: string | null;
}) {
  if (users.length === 0) {
    return <EmptyState size="md" title="No Supabase users" message="Sign up at least one user in the Lovable balance app." />;
  }
  return (
    <div className="balance-table">
      <table>
        <thead>
          <tr>
            <th style={{ width: '30%' }}>Supabase user</th>
            <th>Maps to CRM tech name(s)</th>
            <th style={{ width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const selected = draft[u.id] || [];
            const isSaving = savingId === u.id;
            const flashed = savedFlash === u.id;
            return (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.fullName || '(no name)'}</div>
                  {u.role && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{u.role}</div>}
                </td>
                <td>
                  <MultiPicker
                    options={crmTechs}
                    selected={selected}
                    onChange={(next) => setDraft((prev) => ({ ...prev, [u.id]: next }))}
                    placeholder="Search CRM tech names…"
                    emptyText="No CRM tech names match"
                  />
                </td>
                <td>
                  <button
                    className="pmr-clear-btn"
                    onClick={() => onSave(u)}
                    disabled={isSaving}
                    style={{
                      background: flashed ? 'rgba(34,197,94,0.18)' : undefined,
                      borderColor: flashed ? 'rgba(34,197,94,0.4)' : undefined,
                      color: flashed ? '#86efac' : undefined,
                    }}
                  >
                    {flashed ? <><FiCheck style={{ verticalAlign: 'middle', marginRight: 4 }} />Saved</> : isSaving ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── AREA MAPPINGS ──────────────────────────────────────────────────────────

function AreaMappingsTable({
  areas, crmLocations, draft, setDraft, onSave, savingId, savedFlash,
}: {
  areas: SupabaseArea[];
  crmLocations: string[];
  draft: Record<string, string[]>;
  setDraft: (fn: (prev: Record<string, string[]>) => Record<string, string[]>) => void;
  onSave: (a: SupabaseArea) => void;
  savingId: string | null;
  savedFlash: string | null;
}) {
  if (areas.length === 0) {
    return <EmptyState size="md" title="No Supabase areas" message="Define at least one area in the Lovable balance app." />;
  }
  return (
    <div className="balance-table">
      <table>
        <thead>
          <tr>
            <th style={{ width: '30%' }}>Supabase area</th>
            <th>Maps to CRM location(s)</th>
            <th style={{ width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {areas.map((a) => {
            const selected = draft[a.id] || [];
            const isSaving = savingId === a.id;
            const flashed = savedFlash === a.id;
            return (
              <tr key={a.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{a.name || '(no name)'}</div>
                </td>
                <td>
                  <MultiPicker
                    options={crmLocations}
                    selected={selected}
                    onChange={(next) => setDraft((prev) => ({ ...prev, [a.id]: next }))}
                    placeholder="Search CRM locations…"
                    emptyText="No CRM locations match"
                  />
                </td>
                <td>
                  <button
                    className="pmr-clear-btn"
                    onClick={() => onSave(a)}
                    disabled={isSaving}
                    style={{
                      background: flashed ? 'rgba(34,197,94,0.18)' : undefined,
                      borderColor: flashed ? 'rgba(34,197,94,0.4)' : undefined,
                      color: flashed ? '#86efac' : undefined,
                    }}
                  >
                    {flashed ? <><FiCheck style={{ verticalAlign: 'middle', marginRight: 4 }} />Saved</> : isSaving ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── MULTI PICKER ───────────────────────────────────────────────────────────
// Searchable list of checkboxes with selected-pills row above.

function MultiPicker({
  options, selected, onChange, placeholder, emptyText,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  emptyText: string;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter((n) => n !== name));
    else onChange([...selected, name]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {selected.map((s) => (
            <span
              key={s}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 999,
                background: 'rgba(99,102,241,0.18)',
                border: '1px solid rgba(99,102,241,0.35)',
                color: '#c7d2fe', fontSize: 12, fontWeight: 500,
              }}
            >
              {s}
              <button
                onClick={() => toggle(s)}
                style={{ background: 'transparent', border: 'none', color: '#c7d2fe', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                aria-label={`Remove ${s}`}
              >
                <FiX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <FiSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', padding: '8px 10px 8px 30px', fontSize: 13,
            background: 'rgba(15,23,42,0.5)', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, outline: 'none',
          }}
        />
      </div>
      <div
        style={{
          maxHeight: 180, overflowY: 'auto',
          background: 'rgba(15,23,42,0.4)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
          padding: 4,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: '#64748b', textAlign: 'center' }}>{emptyText}</div>
        ) : (
          filtered.map((o) => {
            const isOn = selected.includes(o);
            return (
              <label
                key={o}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                  background: isOn ? 'rgba(99,102,241,0.1)' : 'transparent',
                  fontSize: 13, color: '#cbd5e1',
                }}
                onMouseEnter={(e) => { if (!isOn) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { if (!isOn) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(o)}
                  style={{ accentColor: '#6366f1' }}
                />
                <span>{o}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
