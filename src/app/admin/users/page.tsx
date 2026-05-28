'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  FiUserPlus, FiKey, FiEdit2, FiTrash2, FiUserCheck, FiUserX, FiX, FiSearch,
} from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import EmptyState from '@/components/EmptyState';
import type { User, UserType } from '@/types/user';
import type { Permission } from '@/types/rbac';
import { PERMISSION_CATALOG, MODULE_LABEL } from '@/types/rbac';
import './styles.css';

type Role = {
  _id: string;
  key: string;
  label: string;
  description: string;
  permissions: Permission[];
  permissionCount: number;
  is_system: boolean;
};

type UserRow = Omit<User, 'password'>;

const USER_TYPES: UserType[] = ['admin', 'office', 'location-manager', 'bookkeeper', 'simple'];

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Edit / password / create modal state
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, r] = await Promise.all([
        fetch('/api/users').then((res) => res.json()),
        fetch('/api/roles').then((res) => res.json()).catch(() => ({ rows: [] })),
      ]);
      if (u.error) throw new Error(u.detail || u.error);
      setUsers(Array.isArray(u.rows) ? u.rows : Array.isArray(u) ? u : []);
      setRoles(Array.isArray(r.rows) ? r.rows : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const roleByKey = useMemo(() => new Map(roles.map((r) => [r.key, r])), [roles]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r._id, r])), [roles]);

  const visibleUsers = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter((u) =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.type || '').toLowerCase().includes(q),
    );
  }, [users, search]);

  if (!user || user.type !== 'admin') {
    return (
      <main className="adm-page">
        <EmptyState size="lg" title="Access Denied" message="Only admins can manage users." />
      </main>
    );
  }

  const handleResetPassword = async (target: UserRow, newPassword: string) => {
    const res = await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id: target._id, password: newPassword }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
    load();
  };

  const handleToggleActive = async (target: UserRow) => {
    if (target._id === user._id && target.active !== false) {
      if (!confirm('Disable your OWN account? You will be logged out and locked out.')) return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: target._id, active: !(target.active !== false) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      load();
    } catch (e: any) {
      setError(e?.message || 'Failed to toggle');
    }
  };

  const handleDelete = async (target: UserRow) => {
    if (target._id === user._id) {
      setError("You can't delete your own account.");
      return;
    }
    if (!confirm(`Delete user "${target.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/users?id=${encodeURIComponent(target._id || '')}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      load();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  };

  return (
    <main className="adm-page">
      <div className="adm-content">
        <header className="adm-header">
          <div>
            <p className="adm-kicker">System</p>
            <h1 className="adm-title">Users & Permissions</h1>
            <p className="adm-subtitle">Reset passwords, assign roles, enable/disable login.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="adm-search">
              <FiSearch size={14} />
              <input
                type="text"
                placeholder="Filter by name, email, role…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button className="adm-btn adm-btn-primary" onClick={() => setCreating(true)}>
              <FiUserPlus size={14} /> New user
            </button>
          </div>
        </header>

        {error && (
          <div className="adm-error">
            <span>{error}</span>
            <button onClick={() => setError(null)}><FiX size={14} /></button>
          </div>
        )}

        <div className="adm-card" style={{ position: 'relative', minHeight: 200 }}>
          {loading && users.length === 0 && <LoadingOverlay message="Loading users…" />}
          {!loading && visibleUsers.length === 0 ? (
            <EmptyState size="md" title="No users" message={search ? "No matches." : "Click 'New user' to create one."} />
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Type</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => {
                  const isMe = u._id === user._id;
                  const active = u.active !== false;
                  const role = u.role_id ? roleById.get(u.role_id) : (u.type ? roleByKey.get(u.type) : undefined);
                  return (
                    <tr key={u._id} className={!active ? 'adm-row-dim' : ''}>
                      <td>
                        <strong>{u.name}</strong>
                        {isMe && <span className="adm-tag" style={{ marginLeft: 6 }}>You</span>}
                      </td>
                      <td>{u.email || <span className="adm-muted">—</span>}</td>
                      <td><span className="adm-pill">{u.type || 'simple'}</span></td>
                      <td>
                        {role ? (
                          <span title={role.description || role.key}>
                            {role.label}
                            <span className="adm-muted" style={{ marginLeft: 6, fontSize: 11 }}>({role.permissionCount})</span>
                          </span>
                        ) : <span className="adm-muted">— (auto-migrate)</span>}
                      </td>
                      <td>
                        {active
                          ? <span className="adm-badge adm-badge-ok">Active</span>
                          : <span className="adm-badge adm-badge-warn">Disabled</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="adm-actions">
                          <button title="Reset password" className="adm-icon-btn" onClick={() => setResetting(u)}>
                            <FiKey size={13} />
                          </button>
                          <button title="Edit user" className="adm-icon-btn" onClick={() => setEditing(u)}>
                            <FiEdit2 size={13} />
                          </button>
                          <button
                            title={active ? 'Disable login' : 'Enable login'}
                            className="adm-icon-btn"
                            onClick={() => handleToggleActive(u)}
                          >
                            {active ? <FiUserX size={13} /> : <FiUserCheck size={13} />}
                          </button>
                          <button
                            title="Delete user"
                            className="adm-icon-btn adm-icon-btn-danger"
                            onClick={() => handleDelete(u)}
                            disabled={isMe}
                          >
                            <FiTrash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {resetting && (
        <ResetPasswordModal
          target={resetting}
          onClose={() => setResetting(null)}
          onSubmit={async (pw) => {
            await handleResetPassword(resetting, pw);
            setResetting(null);
          }}
        />
      )}
      {editing && (
        <EditUserModal
          target={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {creating && (
        <CreateUserModal
          roles={roles}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
    </main>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function ModalShell({
  title, onClose, children, wide,
}: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className={`adm-modal ${wide ? 'adm-modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="adm-modal-header">
          <h3>{title}</h3>
          <button className="adm-icon-btn" onClick={onClose}><FiX size={14} /></button>
        </div>
        <div className="adm-modal-body">{children}</div>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  target, onClose, onSubmit,
}: { target: UserRow; onClose: () => void; onSubmit: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 4) return setErr('Password must be at least 4 characters.');
    if (pw !== pw2) return setErr('Passwords do not match.');
    setBusy(true);
    setErr(null);
    try { await onSubmit(pw); }
    catch (e: any) { setErr(e?.message || 'Failed to reset password'); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title={`Reset password — ${target.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="adm-field">
          <label>New password</label>
          <input className="adm-input" type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        <div className="adm-field">
          <label>Confirm</label>
          <input className="adm-input" type="text" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {err && <div className="adm-error" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="adm-modal-actions">
          <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Reset password'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

type PermState = 'inherit' | 'grant' | 'deny';

function EditUserModal({
  target, roles, onClose, onSaved,
}: { target: UserRow; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'profile' | 'permissions'>('profile');
  const [name, setName] = useState(target.name || '');
  const [email, setEmail] = useState(target.email || '');
  const [type, setType] = useState<UserType>((target.type as UserType) || 'simple');
  const [roleId, setRoleId] = useState<string>(target.role_id || '');
  const [extra, setExtra] = useState<Set<Permission>>(new Set(target.extra_permissions ?? []));
  const [denied, setDenied] = useState<Set<Permission>>(new Set(target.denied_permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Resolve the active role record so we know which permissions are inherited.
  const activeRole = useMemo(() => {
    if (roleId) return roles.find((r) => r._id === roleId);
    return roles.find((r) => r.key === type);
  }, [roleId, type, roles]);
  const inherited = useMemo(
    () => new Set<Permission>(activeRole?.permissions ?? []),
    [activeRole],
  );

  // Catalog grouped by module → section for display.
  const grouped = useMemo(() => {
    const out = new Map<string, Map<string, typeof PERMISSION_CATALOG[number][]>>();
    for (const p of PERMISSION_CATALOG) {
      let bySection = out.get(p.module);
      if (!bySection) { bySection = new Map(); out.set(p.module, bySection); }
      const list = bySection.get(p.section) || [];
      list.push(p);
      bySection.set(p.section, list);
    }
    return out;
  }, []);

  const stateFor = (key: Permission): PermState => {
    if (denied.has(key)) return 'deny';
    if (extra.has(key)) return 'grant';
    return 'inherit';
  };

  const setStateFor = (key: Permission, next: PermState) => {
    const newExtra = new Set(extra);
    const newDenied = new Set(denied);
    newExtra.delete(key);
    newDenied.delete(key);
    if (next === 'grant') newExtra.add(key);
    if (next === 'deny') newDenied.add(key);
    setExtra(newExtra);
    setDenied(newDenied);
  };

  const effectiveHas = (key: Permission): boolean => {
    if (denied.has(key)) return false;
    if (extra.has(key)) return true;
    return inherited.has(key);
  };

  const effectiveCount = useMemo(
    () => PERMISSION_CATALOG.reduce((n, p) => n + (effectiveHas(p.key) ? 1 : 0), 0),
    [extra, denied, inherited],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body: any = {
        _id: target._id,
        name, email, type,
        extra_permissions: [...extra],
        denied_permissions: [...denied],
      };
      // Clear role_id when type changes so the next request's RBAC migration
      // re-attaches the canonical system role for the new type.
      if (target.type !== type) body.role_id = null;
      else if (roleId) body.role_id = roleId;
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally { setBusy(false); }
  };

  const moduleOrder = ['system', 'crm', 'finance'] as const;

  return (
    <ModalShell title={`Edit — ${target.name}`} onClose={onClose} wide>
      <div className="adm-tabs">
        <button
          type="button"
          className={`adm-tab ${tab === 'profile' ? 'active' : ''}`}
          onClick={() => setTab('profile')}
        >Profile</button>
        <button
          type="button"
          className={`adm-tab ${tab === 'permissions' ? 'active' : ''}`}
          onClick={() => setTab('permissions')}
        >Permissions <span className="adm-muted" style={{ marginLeft: 4 }}>({effectiveCount})</span></button>
      </div>

      <form onSubmit={submit}>
        {tab === 'profile' && (
          <>
            <div className="adm-field">
              <label>Name</label>
              <input className="adm-input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Email (optional)</label>
              <input className="adm-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="adm-field">
              <label>Type (legacy)</label>
              <select className="adm-input" value={type} onChange={(e) => setType(e.target.value as UserType)}>
                {USER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="adm-field">
              <label>Role</label>
              <select className="adm-input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">(auto from type)</option>
                {roles.map((r) => (
                  <option key={r._id} value={r._id}>{r.label} ({r.permissionCount})</option>
                ))}
              </select>
              {activeRole && (
                <div className="adm-muted" style={{ marginTop: 4 }}>
                  Inherits {inherited.size} of {PERMISSION_CATALOG.length} catalog permissions from{' '}
                  <strong>{activeRole.label}</strong>.
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'permissions' && (
          <div className="adm-perm-grid">
            <div className="adm-perm-legend">
              <span><span className="adm-perm-chip adm-perm-inherit" /> Inherit from role</span>
              <span><span className="adm-perm-chip adm-perm-grant" /> Grant (extra)</span>
              <span><span className="adm-perm-chip adm-perm-deny" /> Deny (override)</span>
            </div>
            {moduleOrder.map((mod) => {
              const sections = grouped.get(mod);
              if (!sections) return null;
              return (
                <div key={mod} className="adm-perm-module">
                  <h4>{MODULE_LABEL[mod]}</h4>
                  {[...sections.entries()].map(([section, perms]) => (
                    <div key={section} className="adm-perm-section">
                      <div className="adm-perm-section-label">{section}</div>
                      {perms.map((p) => {
                        const state = stateFor(p.key);
                        const inheritedHere = inherited.has(p.key);
                        return (
                          <div key={p.key} className="adm-perm-row">
                            <div className="adm-perm-meta">
                              <div className="adm-perm-label">
                                {p.label}
                                {inheritedHere && <span className="adm-perm-from-role" title="Granted by current role">role</span>}
                              </div>
                              {p.description && <div className="adm-perm-desc">{p.description}</div>}
                            </div>
                            <div className="adm-perm-toggle">
                              <button
                                type="button"
                                className={`adm-perm-btn ${state === 'inherit' ? 'active' : ''}`}
                                onClick={() => setStateFor(p.key, 'inherit')}
                                title="Use role default"
                              >Inherit</button>
                              <button
                                type="button"
                                className={`adm-perm-btn adm-perm-btn-grant ${state === 'grant' ? 'active' : ''}`}
                                onClick={() => setStateFor(p.key, 'grant')}
                                title="Force grant"
                                disabled={inheritedHere && state !== 'grant'}
                              >Grant</button>
                              <button
                                type="button"
                                className={`adm-perm-btn adm-perm-btn-deny ${state === 'deny' ? 'active' : ''}`}
                                onClick={() => setStateFor(p.key, 'deny')}
                                title="Force deny"
                              >Deny</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {err && <div className="adm-error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="adm-modal-actions" style={{ marginTop: 16 }}>
          <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function CreateUserModal({
  roles, onClose, onCreated,
}: { roles: Role[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [type, setType] = useState<UserType>('office');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Name is required.');
    if (password.length < 4) return setErr('Password must be at least 4 characters.');
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email, password, type, active: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      onCreated();
    } catch (e: any) {
      setErr(e?.message || 'Create failed');
    } finally { setBusy(false); }
  };

  return (
    <ModalShell title="New user" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="adm-field"><label>Name</label>
          <input className="adm-input" type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="adm-field"><label>Email (optional)</label>
          <input className="adm-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="adm-field"><label>Initial password</label>
          <input className="adm-input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="adm-field"><label>Type</label>
          <select className="adm-input" value={type} onChange={(e) => setType(e.target.value as UserType)}>
            {USER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {err && <div className="adm-error" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="adm-modal-actions">
          <button type="button" className="adm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
