'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FiArrowLeft, FiSave, FiTrash2, FiUpload, FiDownload, FiPlus } from 'react-icons/fi';
import { useAuth } from '@/components/AuthShell';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import MultiSelect from '@/components/MultiSelect';
import { formatCurrency } from '../../utils/jobUtils';
import type { Location } from '@/types/job';
import type { AreaManager, AreaManagerBalance, AreaManagerPayment, PaymentDirection } from '@/types/areaManager';
import '../styles.css';

type LocationOpt = { _id: string };

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

export default function AreaManagerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [am, setAm] = useState<AreaManager | null>(null);
  const [balance, setBalance] = useState<AreaManagerBalance | null>(null);
  const [payments, setPayments] = useState<AreaManagerPayment[]>([]);
  const [locations, setLocations] = useState<LocationOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [w9Busy, setW9Busy] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [locationIds, setLocationIds] = useState<string[]>([]);

  // Payment form
  const today = new Date().toISOString().slice(0, 10);
  const [pDate, setPDate] = useState(today);
  const [pAmount, setPAmount] = useState('');
  const [pDirection, setPDirection] = useState<PaymentDirection>('company_to_am');
  const [pMethod, setPMethod] = useState('check');
  const [pNote, setPNote] = useState('');

  const loadAm = async () => {
    try {
      setLoading(true);
      setError(null);
      const [amRes, balRes, payRes, locRes] = await Promise.all([
        fetch(`/api/area-managers/${id}`).then((r) => r.json()),
        fetch(`/api/area-managers/${id}/balance`).then((r) => r.json()),
        fetch(`/api/area-managers/${id}/payments`).then((r) => r.json()),
        fetch('/api/locations?page=1&pageSize=500').then((r) => r.json()),
      ]);
      if (amRes.error) throw new Error(amRes.detail || amRes.error);
      const a: AreaManager = amRes.areaManager;
      setAm(a);
      setName(a.name);
      setEmail(a.email || '');
      setPhone(a.phone || '');
      setNotes(a.notes || '');
      setLocationIds(a.locationIds || []);
      setBalance(balRes as AreaManagerBalance);
      setPayments(payRes.rows || []);
      setLocations(Array.isArray(locRes?.rows) ? locRes.rows : Array.isArray(locRes) ? locRes : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (id) loadAm(); }, [id]);

  const refreshBalance = async () => {
    try {
      const b = await fetch(`/api/area-managers/${id}/balance`).then((r) => r.json());
      setBalance(b);
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/area-managers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, notes, locationIds }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      setAm(j.updated);
      refreshBalance();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this area manager? This also removes recorded payments and the W9 file.')) return;
    try {
      const res = await fetch(`/api/area-managers/${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      router.push('/area-managers');
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(pAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Payment amount must be a positive number.');
      return;
    }
    try {
      const res = await fetch(`/api/area-managers/${id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: pDate, amount, direction: pDirection, method: pMethod, note: pNote,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      setPayments((prev) => [j.created, ...prev]);
      setPAmount('');
      setPNote('');
      refreshBalance();
    } catch (e: any) {
      setError(e?.message || 'Failed to record payment');
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Delete this payment record?')) return;
    try {
      const res = await fetch(`/api/area-managers/${id}/payments/${paymentId}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      setPayments((prev) => prev.filter((p) => p._id !== paymentId));
      refreshBalance();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete payment');
    }
  };

  const handleW9Upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setW9Busy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/area-managers/${id}/w9`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      // Refresh AM record to reflect new w9 metadata
      const amRes = await fetch(`/api/area-managers/${id}`).then((r) => r.json());
      setAm(amRes.areaManager);
    } catch (e: any) {
      setError(e?.message || 'W9 upload failed');
    } finally {
      setW9Busy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleW9Download = async () => {
    try {
      const res = await fetch(`/api/area-managers/${id}/w9/download`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      window.open(j.url, '_blank', 'noopener');
    } catch (e: any) {
      setError(e?.message || 'W9 download failed');
    }
  };

  const handleW9Delete = async () => {
    if (!confirm('Remove the W9 file on record?')) return;
    setW9Busy(true);
    try {
      const res = await fetch(`/api/area-managers/${id}/w9`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      const amRes = await fetch(`/api/area-managers/${id}`).then((r) => r.json());
      setAm(amRes.areaManager);
    } catch (e: any) {
      setError(e?.message || 'W9 delete failed');
    } finally { setW9Busy(false); }
  };

  const locationOptions = useMemo(() => locations.map((l) => l._id), [locations]);

  if (!user || user.type !== 'admin') {
    return <main className="am-page"><div className="am-content"><p>Admin access required.</p></div></main>;
  }

  return (
    <main className="am-page">
      <div className="am-content" style={{ position: 'relative', minHeight: 200 }}>
        {loading && <LoadingOverlay message="Loading…" />}

        <header className="am-header">
          <div>
            <Link href="/area-managers" className="am-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
              <FiArrowLeft size={14} /> Back to all
            </Link>
            <h1 className="am-title" style={{ marginTop: 8 }}>{am?.name || '…'}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="am-btn am-btn-danger" onClick={handleDelete}><FiTrash2 size={14} /> Delete</button>
            <button className="am-btn am-btn-primary" onClick={handleSave} disabled={saving}>
              <FiSave size={14} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </header>

        {error && <div className="am-error">{error}</div>}

        <div className="am-detail-grid">
          {/* Profile */}
          <div className="am-panel">
            <h3>Profile</h3>
            <div className="am-field">
              <label>Name</label>
              <input className="am-input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="am-field">
              <label>Email</label>
              <input className="am-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="am-field">
              <label>Phone</label>
              <input className="am-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="am-field">
              <label>Locations</label>
              <MultiSelect
                options={locationOptions}
                selected={locationIds}
                onChange={setLocationIds}
                placeholder="Pick locations…"
                allLabel="(none)"
              />
            </div>
            <div className="am-field">
              <label>Notes</label>
              <textarea className="am-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {/* W9 + Balance */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="am-panel">
              <h3>W9 on file</h3>
              {am?.w9StoragePath ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, color: '#cbd5e1' }}>
                    <strong>{am.w9FileName}</strong>
                    <span className="am-muted" style={{ marginLeft: 8 }}>uploaded {fmtDate(am.w9UploadedAt)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="am-btn am-btn-primary" onClick={handleW9Download} disabled={w9Busy}>
                      <FiDownload size={14} /> Download
                    </button>
                    <label className="am-btn">
                      <FiUpload size={14} /> Replace
                      <input ref={fileInputRef} type="file" accept=".pdf,image/*" onChange={handleW9Upload} style={{ display: 'none' }} />
                    </label>
                    <button className="am-btn am-btn-danger" onClick={handleW9Delete} disabled={w9Busy}>
                      <FiTrash2 size={14} /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="am-muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
                    No W9 uploaded. PDF or image up to 10 MB.
                  </p>
                  <label className="am-btn am-btn-primary">
                    <FiUpload size={14} /> Upload W9
                    <input ref={fileInputRef} type="file" accept=".pdf,image/*" onChange={handleW9Upload} style={{ display: 'none' }} />
                  </label>
                </div>
              )}
              {w9Busy && <div className="am-muted" style={{ marginTop: 8, fontSize: 12 }}>Working…</div>}
            </div>

            <div className="am-panel">
              <h3>Settlement balance</h3>
              <div className="am-balance-grid">
                <div className="am-balance-cell">
                  <div className="am-balance-label">Company owes AM</div>
                  <div className="am-balance-value" style={{ color: '#34d399' }}>{formatCurrency(balance?.companyOwesAm || 0)}</div>
                </div>
                <div className="am-balance-cell">
                  <div className="am-balance-label">AM owes Company</div>
                  <div className="am-balance-value" style={{ color: '#fbbf24' }}>{formatCurrency(balance?.amOwesCompany || 0)}</div>
                </div>
                <div className="am-balance-cell">
                  <div className="am-balance-label">Net paid</div>
                  <div className="am-balance-value">{formatCurrency(balance?.netPaid || 0)}</div>
                </div>
                <div className="am-balance-cell" style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }}>
                  <div className="am-balance-label">Open balance</div>
                  <div className="am-balance-value" style={{ color: (balance?.openBalance ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
                    {formatCurrency(balance?.openBalance || 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Payment history */}
        <div className="am-panel">
          <h3>Settlement payments</h3>

          <form className="am-payment-form" onSubmit={handleRecordPayment}>
            <div className="am-field">
              <label>Date</label>
              <input className="am-input" type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
            </div>
            <div className="am-field">
              <label>Amount</label>
              <input className="am-input" type="number" step="0.01" min="0" value={pAmount} onChange={(e) => setPAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="am-field">
              <label>Direction</label>
              <select className="am-input" value={pDirection} onChange={(e) => setPDirection(e.target.value as PaymentDirection)}>
                <option value="company_to_am">Company → AM</option>
                <option value="am_to_company">AM → Company</option>
              </select>
            </div>
            <div className="am-field">
              <label>Method</label>
              <select className="am-input" value={pMethod} onChange={(e) => setPMethod(e.target.value)}>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="transfer">Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="am-field" style={{ gridColumn: 'span 2' }}>
              <label>Note (optional)</label>
              <input className="am-input" type="text" value={pNote} onChange={(e) => setPNote(e.target.value)} />
            </div>
            <button type="submit" className="am-btn am-btn-primary">
              <FiPlus size={14} /> Record
            </button>
          </form>

          {payments.length === 0 ? (
            <p className="am-muted" style={{ fontSize: 13 }}>No payments recorded yet.</p>
          ) : (
            <table className="am-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Direction</th>
                  <th>Method</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p._id}>
                    <td>{p.date}</td>
                    <td>{p.direction === 'company_to_am' ? 'Company → AM' : 'AM → Company'}</td>
                    <td>{p.method}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ color: p.direction === 'company_to_am' ? '#34d399' : '#fbbf24' }}>
                        {formatCurrency(p.amount)}
                      </span>
                    </td>
                    <td>{p.note || <span className="am-muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="am-btn am-btn-danger" onClick={() => handleDeletePayment(p._id!)} style={{ padding: '4px 10px', fontSize: 12 }}>
                        <FiTrash2 size={12} />
                      </button>
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
