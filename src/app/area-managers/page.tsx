'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FiUserPlus, FiUsers } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import EmptyState from '@/components/EmptyState';
import { formatCurrency } from '../utils/jobUtils';
import type { AreaManager, AreaManagerBalance } from '@/types/areaManager';
import './styles.css';

type Row = AreaManager & { balance?: AreaManagerBalance };

export default function AreaManagersPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/area-managers');
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      const list: AreaManager[] = j.rows || [];
      setRows(list);
      // Lazily fetch each AM's balance — non-blocking on page render.
      list.forEach(async (am) => {
        try {
          const b = await fetch(`/api/area-managers/${am._id}/balance`).then((r) => r.json());
          setRows((prev) => prev.map((r) => (r._id === am._id ? { ...r, balance: b as AreaManagerBalance } : r)));
        } catch { /* ignore per-row balance errors */ }
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/area-managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      setNewName('');
      load();
    } catch (e: any) {
      setError(e?.message || 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  if (!user || (user.type !== 'admin' && user.type !== 'location-manager')) {
    return (
      <main className="am-page">
        <div className="flex h-[60vh] items-center justify-center px-6">
          <EmptyState size="lg" title="Access Denied" message="This page is only for administrators." />
        </div>
      </main>
    );
  }

  return (
    <main className="am-page">
      <div className="am-content">
        <header className="am-header">
          <div>
            <p className="am-kicker">Settlements</p>
            <h1 className="am-title">Area Managers</h1>
            <p className="am-subtitle">Per-AM profile, settlement balance, payment history, and W9 on file.</p>
          </div>
          <form className="am-create-form" onSubmit={handleCreate}>
            <input
              className="am-input"
              type="text"
              placeholder="New area manager name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
            />
            <button type="submit" className="am-btn am-btn-primary" disabled={creating || !newName.trim()}>
              <FiUserPlus size={14} /> Add
            </button>
          </form>
        </header>

        {error && <div className="am-error">{error}</div>}

        <div className="am-table-card" style={{ position: 'relative', minHeight: 200 }}>
          {loading && rows.length === 0 && <LoadingOverlay message="Loading area managers..." />}
          {!loading && rows.length === 0 ? (
            <EmptyState
              size="md"
              icon={<FiUsers size={22} />}
              title="No area managers yet"
              message="Add your first AM above. You can attach locations, record settlements, and upload a W9 from each profile."
            />
          ) : (
            <table className="am-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Locations</th>
                  <th>W9</th>
                  <th style={{ textAlign: 'right' }}>Open Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <Link className="am-link" href={`/area-managers/${r._id}`}>{r.name}</Link>
                    </td>
                    <td>{r.email || <span className="am-muted">—</span>}</td>
                    <td>{r.phone || <span className="am-muted">—</span>}</td>
                    <td>{r.locationIds.length || 0}</td>
                    <td>
                      {r.w9StoragePath
                        ? <span className="am-badge am-badge-ok">On file</span>
                        : <span className="am-badge am-badge-warn">Missing</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.balance
                        ? (
                          <span style={{ color: r.balance.openBalance >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                            {formatCurrency(r.balance.openBalance)}
                          </span>
                        )
                        : <span className="am-muted">…</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
