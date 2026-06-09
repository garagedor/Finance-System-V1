'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft, FiSave, FiTrash2, FiLock, FiCheckSquare, FiSquare } from 'react-icons/fi';
import { PERMISSION_CATALOG, MODULE_LABEL, type PermissionDef } from '@/types/rbac';
import { AdminTabs } from '../../_components/AdminTabs';

export type Role = {
    _id: string;
    key: string;
    label: string;
    description: string;
    permissions: string[];
    permissionCount: number;
    is_system: boolean;
};

// Group the catalog as {module → section → permissions[]} so the matrix
// reads top-to-bottom by feature area. The catalog itself is already in
// display order; we just preserve it.
type SectionGroup = { section: string; defs: PermissionDef[] };
type ModuleGroup  = { module: string; label: string; sections: SectionGroup[] };

const groupCatalog = (): ModuleGroup[] => {
    const byModule = new Map<string, Map<string, PermissionDef[]>>();
    for (const def of PERMISSION_CATALOG) {
        if (!byModule.has(def.module)) byModule.set(def.module, new Map());
        const secs = byModule.get(def.module)!;
        if (!secs.has(def.section)) secs.set(def.section, []);
        secs.get(def.section)!.push(def);
    }
    return Array.from(byModule.entries()).map(([module, secs]) => ({
        module,
        label: MODULE_LABEL[module as keyof typeof MODULE_LABEL] || module,
        sections: Array.from(secs.entries()).map(([section, defs]) => ({ section, defs })),
    }));
};

const sectionLabel = (s: string): string =>
    s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function RoleEditor({ initial, onSaved }: { initial: Role; onSaved: (r: Role) => void }) {
    const router = useRouter();
    const [label, setLabel] = useState(initial.label);
    const [description, setDescription] = useState(initial.description);
    const [perms, setPerms] = useState<Set<string>>(new Set(initial.permissions));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<string | null>(null);

    const groups = useMemo(groupCatalog, []);

    const togglePerm = (key: string) => {
        setPerms((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // Bulk-toggle helpers for whole sections / modules so building a role
    // doesn't mean clicking 60 individual checkboxes for "give them
    // everything in CRM" or similar.
    const toggleSection = (defs: PermissionDef[]) => {
        const allOn = defs.every((d) => perms.has(d.key));
        setPerms((prev) => {
            const next = new Set(prev);
            for (const d of defs) {
                if (allOn) next.delete(d.key);
                else next.add(d.key);
            }
            return next;
        });
    };

    const toggleModule = (mod: ModuleGroup) => {
        const all = mod.sections.flatMap((s) => s.defs);
        const allOn = all.every((d) => perms.has(d.key));
        setPerms((prev) => {
            const next = new Set(prev);
            for (const d of all) {
                if (allOn) next.delete(d.key);
                else next.add(d.key);
            }
            return next;
        });
    };

    const dirty =
        label !== initial.label ||
        description !== initial.description ||
        perms.size !== initial.permissions.length ||
        Array.from(perms).some((k) => !initial.permissions.includes(k));

    const save = async () => {
        setSaving(true); setError(null); setSavedAt(null);
        try {
            const res = await fetch(`/api/roles/${encodeURIComponent(initial._id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, description, permissions: Array.from(perms) }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || json.error || 'Failed to save role');
            onSaved(json.row);
            setSavedAt(new Date().toLocaleTimeString());
        } catch (e: any) {
            setError(e?.message || 'Failed to save role');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!confirm(`Delete role "${initial.label}"? This cannot be undone.`)) return;
        setDeleting(true); setError(null);
        try {
            const res = await fetch(`/api/roles/${encodeURIComponent(initial._id)}`, { method: 'DELETE' });
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || json.error || 'Failed to delete role');
            router.push('/admin/roles');
        } catch (e: any) {
            setError(e?.message || 'Failed to delete role');
            setDeleting(false);
        }
    };

    return (
        <>
            <header className="adm-header">
                <div>
                    <p className="adm-kicker">
                        <Link href="/admin/roles" className="adm-back">
                            <FiArrowLeft size={11} />Roles
                        </Link>
                        &nbsp;/ Edit role
                    </p>
                    <h1 className="adm-title">
                        {initial.label}
                        {initial.is_system && (
                            <span className="adm-badge adm-badge--system" style={{ marginLeft: 12, verticalAlign: 'middle' }}>
                                <FiLock size={10} /> System
                            </span>
                        )}
                    </h1>
                    <p className="adm-subtitle">
                        <code className="adm-role-key">{initial.key}</code>
                        {' · '}
                        {perms.size} permission{perms.size === 1 ? '' : 's'} selected
                    </p>
                </div>
                <div className="adm-header-actions">
                    {!initial.is_system && (
                        <button
                            className="adm-btn adm-btn--danger"
                            onClick={remove}
                            disabled={deleting || saving}
                        >
                            <FiTrash2 size={14} />
                            {deleting ? 'Deleting…' : 'Delete'}
                        </button>
                    )}
                    <button
                        className="adm-btn adm-btn--primary"
                        onClick={save}
                        disabled={saving || deleting || !dirty}
                    >
                        <FiSave size={14} />
                        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                    </button>
                </div>
            </header>

            <AdminTabs />

            {error && <div className="adm-error">{error}</div>}
            {savedAt && !dirty && <div className="adm-flash">Saved at {savedAt}</div>}

            <div className="adm-card">
                <div className="adm-meta-grid">
                    <label className="adm-field">
                        <span>Display name</span>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="e.g. Office Manager"
                        />
                    </label>
                    <label className="adm-field">
                        <span>Description</span>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What this role does"
                        />
                    </label>
                </div>
            </div>

            <div className="adm-perm-matrix">
                {groups.map((mod) => {
                    const allInMod = mod.sections.flatMap((s) => s.defs);
                    const onInMod = allInMod.filter((d) => perms.has(d.key)).length;
                    const allOn = onInMod === allInMod.length;
                    const partial = onInMod > 0 && !allOn;
                    return (
                        <div key={mod.module} className="adm-perm-module">
                            <div className="adm-perm-module-head">
                                <button
                                    type="button"
                                    className="adm-perm-toggle adm-perm-toggle--module"
                                    onClick={() => toggleModule(mod)}
                                    aria-pressed={allOn}
                                    title={allOn ? 'Disable all in module' : 'Enable all in module'}
                                >
                                    {allOn
                                        ? <FiCheckSquare size={16} />
                                        : <FiSquare size={16} style={{ color: partial ? '#818cf8' : undefined }} />}
                                </button>
                                <h2>{mod.label}</h2>
                                <span className="adm-perm-counter">{onInMod} / {allInMod.length}</span>
                            </div>
                            {mod.sections.map((sec) => {
                                const onInSec = sec.defs.filter((d) => perms.has(d.key)).length;
                                const secAllOn = onInSec === sec.defs.length;
                                const secPartial = onInSec > 0 && !secAllOn;
                                return (
                                    <div key={`${mod.module}/${sec.section}`} className="adm-perm-section">
                                        <div className="adm-perm-section-head">
                                            <button
                                                type="button"
                                                className="adm-perm-toggle"
                                                onClick={() => toggleSection(sec.defs)}
                                                aria-pressed={secAllOn}
                                                title={secAllOn ? 'Disable all in section' : 'Enable all in section'}
                                            >
                                                {secAllOn
                                                    ? <FiCheckSquare size={14} />
                                                    : <FiSquare size={14} style={{ color: secPartial ? '#818cf8' : undefined }} />}
                                            </button>
                                            <h3>{sectionLabel(sec.section)}</h3>
                                            <span className="adm-perm-counter adm-perm-counter--small">
                                                {onInSec} / {sec.defs.length}
                                            </span>
                                        </div>
                                        <div className="adm-perm-grid">
                                            {sec.defs.map((def) => {
                                                const checked = perms.has(def.key);
                                                return (
                                                    <label
                                                        key={def.key}
                                                        className={`adm-perm-row ${checked ? 'adm-perm-row--on' : ''}`}
                                                        title={def.description || def.key}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => togglePerm(def.key)}
                                                        />
                                                        <span className="adm-perm-label">{def.label}</span>
                                                        <code className="adm-perm-key">{def.key}</code>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </>
    );
}
