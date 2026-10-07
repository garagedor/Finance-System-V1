'use client';
import { useState, useMemo } from 'react';
import { FiX } from 'react-icons/fi';
import { formatCurrency } from '../utils/jobUtils';

const modalCloseStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--ds-line-strong)',
  color: 'var(--ds-ink-2)', padding: 6, borderRadius: 6, cursor: 'pointer',
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
        background: 'var(--ds-scrim)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--ds-surface-1)', border: '1px solid var(--ds-line-strong)',
          borderRadius: 12, padding: 20,
          boxShadow: 'var(--ds-elev-3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <p className="bp-section-kicker">Link to CRM job</p>
            <h3 style={{ margin: '4px 0 0', color: 'var(--ds-ink)' }}>
              Pair "{job.address || job.customer_name || 'this report job'}" with a CRM job
            </h3>
            <p style={{ fontSize: 12, color: 'var(--ds-ink-2)', margin: '4px 0 0' }}>
              Pick from CRM jobs that aren't currently paired in this report. The override is saved to our DB only.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={modalCloseStyle}><FiX size={16} /></button>
        </div>

        {/* Direct-ID link: paste any CRM job ObjectId to link without searching. */}
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: 'var(--ds-ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: '0 0 4px' }}>
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
                background: 'var(--ds-surface-2)', color: 'var(--ds-ink)',
                border: `1px solid ${directId && !directIdValid ? 'var(--ds-crit-line)' : 'var(--ds-line-strong)'}`,
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
                background: directIdValid && !savingId ? 'var(--ds-crm-wash)' : 'var(--ds-surface-2)',
                border: `1px solid ${directIdValid && !savingId ? 'var(--ds-crm-line)' : 'var(--ds-line)'}`,
                color: directIdValid && !savingId ? 'var(--ds-crm-text)' : 'var(--ds-ink-dim)',
                cursor: directIdValid && !savingId ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
              }}
            >
              {savingId === directId.trim() ? 'Linking…' : 'Link by ID'}
            </button>
          </div>
          {directId && !directIdValid && (
            <p style={{ fontSize: 11, color: 'var(--ds-crit-text)', margin: '4px 0 0' }}>
              Must be a 24-character hex ID (Mongo ObjectId). You can copy this from any row's _id in the Tables view.
            </p>
          )}
        </div>

        <p style={{ fontSize: 11, color: 'var(--ds-ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, margin: '0 0 4px' }}>
          Or pick from this report's CRM jobs
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by address, customer or date…"
          style={{
            width: '100%',
            background: 'var(--ds-surface-2)', color: 'var(--ds-ink)',
            border: '1px solid var(--ds-line-strong)', borderRadius: 8,
            padding: '8px 10px', fontSize: 13, marginBottom: 12,
          }}
        />

        {err && (
          <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: 'var(--ds-crit-soft)', border: '1px solid var(--ds-crit-line)', color: 'var(--ds-crit-text)', fontSize: 12 }}>
            {err}
          </div>
        )}

        <div style={{ maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--ds-ink-2)', textAlign: 'center' }}>
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
                  background: 'var(--ds-surface-2)',
                  border: '1px solid var(--ds-line)',
                  color: 'var(--ds-ink)', textAlign: 'left',
                  cursor: savingId ? 'not-allowed' : 'pointer',
                  opacity: savingId && !isSaving ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { if (!savingId) (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-line-strong)'; }}
                onMouseLeave={(e) => { if (!savingId) (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-line)'; }}
              >
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {c.address || '(no address)'}
                    {currentlyPairedWith && (
                      <span
                        style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                          padding: '2px 6px', borderRadius: 4,
                          background: 'var(--ds-warn-soft)', color: 'var(--ds-warn-text)',
                          border: '1px solid var(--ds-warn-line)',
                        }}
                      >
                        Currently paired
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ds-ink-2)' }}>
                    {c.date || '—'} · {c.clientName || '(no customer)'}
                    {currentlyPairedWith && (
                      <> · with <em style={{ color: 'var(--ds-ink)' }}>{currentlyPairedWith.address || currentlyPairedWith.customer || 'another job'}</em></>
                    )}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--ds-ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(c.totalAmount || 0)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ds-ink-2)' }}>
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
