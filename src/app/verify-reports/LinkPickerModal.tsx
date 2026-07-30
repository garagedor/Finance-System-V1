'use client';
import { useState, useMemo } from 'react';
import { FiX } from 'react-icons/fi';
import { formatCurrency } from '../utils/jobUtils';

const modalCloseStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
  color: '#94a3b8', padding: 6, borderRadius: 6, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

type CrmPickerOption = { crm: any; currentlyPairedWith: { address: string | null; customer: string | null } | null };

export default function LinkPickerModal({
  job, reportId, options, onClose, onLinked,
}: {
  job: any; // SupabaseReportJob
  reportId: string;
  options: CrmPickerOption[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Direct-id input — accepts any 24-char hex Mongo ObjectId.
  const [directId, setDirectId] = useState('');
  const directIdValid = /^[0-9a-fA-F]{24}$/.test(directId.trim());

  // Sort: unpaired first, then by date.
  const sorted = useMemo(() => {
    const list = [...options].sort((a, b) => {
      const ap = a.currentlyPairedWith ? 1 : 0;
      const bp = b.currentlyPairedWith ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return (a.crm.date || '').localeCompare(b.crm.date || '');
    });
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(({ crm }) => {
      const hay = `${crm.address || ''} ${crm.clientName || ''} ${crm.date || ''} ${crm.totalAmount ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const link = async (crmJobId: string) => {
    setSavingId(crmJobId);
    setErr(null);
    try {
      const res = await fetch(`/api/verify/weekly-reports/${reportId}/jobs/${job.id}/link`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crmJobId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      onLinked();
    } catch (e: any) {
      setErr(String(e?.message || e));
      setSavingId(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(2,6,23,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: '#0d1526', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: 20,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <p className="bp-section-kicker">Link to CRM job</p>
            <h3 style={{ margin: '4px 0 0', color: '#e2e8f0' }}>
              Pair "{job.address || job.customer_name || 'this report job'}" with a CRM job
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Pick from CRM jobs that aren't currently paired in this report. The override is saved to our DB only.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={modalCloseStyle}><FiX size={16} /></button>
        </div>

        {/* Direct-ID link: paste any CRM job ObjectId to link without searching. */}
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: '0 0 4px' }}>
            Link by CRM job ID
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={directId}
              onChange={(e) => setDirectId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && directIdValid) link(directId.trim()); }}
              placeholder="Paste 24-char Mongo ObjectId (e.g. 6a01…f55)"
              style={{
                flex: 1,
                background: 'rgba(15,23,42,0.6)', color: '#e2e8f0',
                border: `1px solid ${directId && !directIdValid ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.10)'}`,
                borderRadius: 8, padding: '8px 10px', fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
            <button
              type="button"
              onClick={() => link(directId.trim())}
              disabled={!directIdValid || !!savingId}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: directIdValid && !savingId ? 'rgba(99,102,241,0.20)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${directIdValid && !savingId ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.08)'}`,
                color: directIdValid && !savingId ? '#c7d2fe' : '#475569',
                cursor: directIdValid && !savingId ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              {savingId === directId.trim() ? 'Linking…' : 'Link by ID'}
            </button>
          </div>
          {directId && !directIdValid && (
            <p style={{ fontSize: 11, color: '#fca5a5', margin: '4px 0 0' }}>
              Must be a 24-character hex ID (Mongo ObjectId). You can copy this from any row's _id in the Tables view.
            </p>
          )}
        </div>

        <p style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: '0 0 4px' }}>
          Or pick from this report's CRM jobs
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by address, customer or date…"
          style={{
            width: '100%',
            background: 'rgba(15,23,42,0.6)', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8,
            padding: '8px 10px', fontSize: 13, marginBottom: 12,
          }}
        />

        {err && (
          <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
              {options.length === 0
                ? 'No CRM jobs in this report’s window.'
                : 'No CRM jobs match your search.'}
            </div>
          )}
          {sorted.map(({ crm: c, currentlyPairedWith }) => {
            const isSaving = savingId === c._id;
            return (
              <button
                key={c._id}
                type="button"
                onClick={() => link(c._id)}
                disabled={!!savingId}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(15,23,42,0.5)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e2e8f0', textAlign: 'left',
                  cursor: savingId ? 'not-allowed' : 'pointer',
                  opacity: savingId && !isSaving ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { if (!savingId) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(99,102,241,0.45)'; }}
                onMouseLeave={(e) => { if (!savingId) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
              >
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {c.address || '(no address)'}
                    {currentlyPairedWith && (
                      <span
                        style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                          padding: '2px 6px', borderRadius: 4,
                          background: 'rgba(245,158,11,0.15)', color: '#fbbf24',
                          border: '1px solid rgba(245,158,11,0.35)',
                        }}
                      >
                        Currently paired
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {c.date || '—'} · {c.clientName || '(no customer)'}
                    {currentlyPairedWith && (
                      <> · with <em style={{ color: '#cbd5e1' }}>{currentlyPairedWith.address || currentlyPairedWith.customer || 'another job'}</em></>
                    )}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: '#a5b4fc', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(c.totalAmount || 0)}
                </span>
                <span style={{ fontSize: 11, color: '#475569' }}>
                  {isSaving ? 'Linking…' : 'Link →'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
