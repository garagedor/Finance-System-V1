'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/AuthShell';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import EmptyState from '@/components/EmptyState';
import { RoleEditor, type Role } from './RoleEditor';
import '../styles.css';

export default function AdminRoleDetailPage() {
    const { user } = useAuth();
    const params = useParams();
    const id = String(params?.id || '');
    const [role, setRole] = useState<Role | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/roles/${encodeURIComponent(id)}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.detail || json.error || 'Failed to load role');
            setRole(json.row);
        } catch (e: any) {
            setError(e?.message || 'Failed to load role');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { if (id) load(); }, [id]);

    if (!user || user.type !== 'admin') {
        return (
            <main className="adm-page">
                <EmptyState size="lg" title="Access Denied" message="Only admins can edit roles." />
            </main>
        );
    }

    return (
        <main className="adm-page">
            <div className="adm-content">
                {loading && <LoadingOverlay message="Loading role…" />}
                {error && <div className="adm-error">{error}</div>}
                {!loading && role && (
                    <RoleEditor initial={role} onSaved={(r) => setRole(r)} />
                )}
            </div>
        </main>
    );
}
