'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiShield, FiPlus, FiSearch, FiX, FiLock } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import EmptyState from '@/components/EmptyState';
import { AdminTabs } from '../_components/AdminTabs';
import './styles.css';

type Role = {
    _id: string;
    key: string;
    label: string;
    description: string;
    permissions: string[];
    permissionCount: number;
    is_system: boolean;
};

export default function AdminRolesPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [creating, setCreating] = useState(false);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/roles');
            const json = await res.json();
            if (json.error) throw new Error(json.detail || json.error);
            setRoles(Array.isArray(json.rows) ? json.rows : []);
        } catch (e: any) {
            setError(e?.message || 'Failed to load roles');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const visible = useMemo(() => {
        if (!search.trim()) return roles;
        const q = search.toLowerCase();
        return roles.filter((r) =>
            r.label.toLowerCase().includes(q) ||
            r.key.toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q),
        );
    }, [roles, search]);

    if (!user || user.type !== 'admin') {
        return (
            <main className="adm-page">
                <EmptyState size="lg" title="Access Denied" message="Only admins can manage roles." />
            </main>
        );
    }

    return (
        <main className="adm-page">
            <div className="adm-content">
                <header className="adm-header">
                    <div>
                        <p className="adm-kicker">Administration</p>
                        <h1 className="adm-title">Users &amp; Roles</h1>
                        <p className="adm-subtitle">
                            Define what each role can see and do. Roles attach to users on the Users tab.
                        </p>
                    </div>
                    <div className="adm-header-actions">
                        <button
                            className="adm-btn adm-btn--primary"
                            onClick={() => setCreating(true)}
                        >
                            <FiPlus size={14} />
                            New Role
                        </button>
                    </div>
                </header>

                <AdminTabs />

                <div className="adm-toolbar">
                    <div className="adm-search">
                        <FiSearch size={14} />
                        <input
                            type="text"
                            placeholder="Search roles…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                            <button className="adm-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                                <FiX size={14} />
                            </button>
                        )}
                    </div>
                    <span className="adm-count">{visible.length} of {roles.length} roles</span>
                </div>

                {error && <div className="adm-error">{error}</div>}

                <div className="adm-card" style={{ position: 'relative', minHeight: 200 }}>
                    {loading && <LoadingOverlay message="Loading roles…" />}
                    {!loading && visible.length === 0 ? (
                        <EmptyState
                            size="md"
                            title={search ? 'No roles match the search' : 'No roles yet'}
                            message={search ? 'Try clearing the search.' : 'Create one to get started.'}
                        />
                    ) : (
                        <table className="adm-roles-table">
                            <thead>
                                <tr>
                                    <th>Role</th>
                                    <th>Key</th>
                                    <th style={{ textAlign: 'right' }}>Permissions</th>
                                    <th style={{ textAlign: 'right' }}>Type</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((r) => (
                                    <tr key={r._id}>
                                        <td>
                                            <div className="adm-role-name">
                                                <FiShield size={14} className="adm-role-icon" />
                                                <div>
                                                    <strong>{r.label}</strong>
                                                    {r.description && <div className="adm-role-desc">{r.description}</div>}
                                                </div>
                                            </div>
                                        </td>
                                        <td><code className="adm-role-key">{r.key}</code></td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span className="adm-perm-count">{r.permissionCount}</span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            {r.is_system
                                                ? <span className="adm-badge adm-badge--system"><FiLock size={10} /> System</span>
                                                : <span className="adm-badge adm-badge--custom">Custom</span>}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <Link href={`/admin/roles/${r._id}`} className="adm-btn adm-btn--small">
                                                Edit
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {creating && (
                <NewRoleModal
                    onClose={() => setCreating(false)}
                    onCreated={(id) => {
                        setCreating(false);
                        router.push(`/admin/roles/${id}`);
                    }}
                />
            )}
        </main>
    );
}

// Inline new-role modal — minimal (label + description only); permissions
// happen on the editor page after creation since that's where the full
// permission matrix lives.
function NewRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
    const [label, setLabel] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const save = async () => {
        setSaving(true); setErr(null);
        try {
            const res = await fetch('/api/roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, description, permissions: [] }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || json.error || 'Failed to create role');
            onCreated(json.row._id);
        } catch (e: any) {
            setErr(e?.message || 'Failed to create');
            setSaving(false);
        }
    };

    return (
        <div className="adm-modal-overlay" onClick={onClose}>
            <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
                <div className="adm-modal-header">
                    <h3>New Role</h3>
                    <button className="adm-icon-btn" onClick={onClose}><FiX size={16} /></button>
                </div>
                <div className="adm-modal-body">
                    <label className="adm-field">
                        <span>Name</span>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="e.g. Office Manager"
                            autoFocus
                        />
                    </label>
                    <label className="adm-field">
                        <span>Description (optional)</span>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What this role can do"
                        />
                    </label>
                    {err && <div className="adm-error">{err}</div>}
                </div>
                <div className="adm-modal-footer">
                    <button className="adm-btn" onClick={onClose}>Cancel</button>
                    <button
                        className="adm-btn adm-btn--primary"
                        onClick={save}
                        disabled={saving || !label.trim()}
                    >
                        {saving ? 'Creating…' : 'Create & Edit'}
                    </button>
                </div>
            </div>
        </div>
    );
}
