'use client';
import { useState, useMemo } from 'react';
import { FiX } from 'react-icons/fi';

export type EditableJob = {
  id: string;
  job_date: string;
  customer_name: string | null;
  address: string | null;
  notes?: string | null;
  tech_paid_cash?: number;
  paid_card?: number;
  paid_company_cash?: number;
  paid_company_check?: number;
  paid_finance?: number;
  tech_parts?: number;
  company_parts?: number;
  tips_card?: number;
  tips_finance?: number;
  tips_company_cash?: number;
  tips_check?: number;
  commission_rate?: number;
  lm_cash?: number;
  lm_check?: number;
  lm_parts?: number;
};

export default function EditJobModal({
  job, reportId, onClose, onSaved,
}: {
  job: EditableJob;
  reportId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditableJob>(() => ({ ...job }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live total preview — sum of all payment fields (matches the CRM's
  // calcPaidSum: includes lm_cash + lm_check).
  const total = useMemo(() => (
    (Number(form.tech_paid_cash) || 0) +
    (Number(form.paid_card) || 0) +
    (Number(form.paid_company_cash) || 0) +
    (Number(form.paid_company_check) || 0) +
    (Number(form.paid_finance) || 0) +
    (Number(form.lm_cash) || 0) +
    (Number(form.lm_check) || 0)
  ), [form]);

  const partsTotal = useMemo(() => (
    (Number(form.tech_parts) || 0) +
    (Number(form.company_parts) || 0) +
    (Number(form.lm_parts) || 0)
  ), [form]);

  const tipsTotal = useMemo(() => (
    (Number(form.tips_card) || 0) +
    (Number(form.tips_finance) || 0) +
    (Number(form.tips_company_cash) || 0) +
    (Number(form.tips_check) || 0)
  ), [form]);

  const setNum = (k: keyof EditableJob) => (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value.replace(/[^0-9.]/g, '');
    const dot = v.indexOf('.');
    if (dot !== -1) {
      v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
    }
    setForm((p) => ({ ...p, [k]: v === '' ? 0 : Number(v) }));
  };

  const setText = (k: keyof EditableJob) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((p) => ({ ...p, [k]: e.target.value }));
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        job_date: form.job_date,
        customer_name: form.customer_name,
        address: form.address,
        notes: form.notes,
        tech_paid_cash: Number(form.tech_paid_cash) || 0,
        paid_card: Number(form.paid_card) || 0,
        paid_company_cash: Number(form.paid_company_cash) || 0,
        paid_company_check: Number(form.paid_company_check) || 0,
        paid_finance: Number(form.paid_finance) || 0,
        tech_parts: Number(form.tech_parts) || 0,
        company_parts: Number(form.company_parts) || 0,
        tips_card: Number(form.tips_card) || 0,
        tips_finance: Number(form.tips_finance) || 0,
        tips_company_cash: Number(form.tips_company_cash) || 0,
        tips_check: Number(form.tips_check) || 0,
        commission_rate: Number(form.commission_rate) || 0,
        lm_cash: Number(form.lm_cash) || 0,
        lm_check: Number(form.lm_check) || 0,
        lm_parts: Number(form.lm_parts) || 0,
      };
      const res = await fetch(`/api/verify/weekly-reports/${reportId}/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);
      onSaved();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
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
          width: '100%', maxWidth: 640,
          background: '#0d1526', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: 20,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <p className="bp-section-kicker">Edit reported job</p>
            <h3 style={{ margin: '4px 0 0', color: '#e2e8f0' }}>Job details</h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Saves to Supabase. Derived totals are recomputed automatically.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={modalCloseStyle}><FiX size={16} /></button>
        </div>

        {error && (
          <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Date">
            <input type="date" value={form.job_date} onChange={setText('job_date')} style={inputStyle} />
          </Field>
          <Field label="Customer">
            <input type="text" value={form.customer_name || ''} onChange={setText('customer_name')} style={inputStyle} />
          </Field>
          <Field label="Address" full>
            <input type="text" value={form.address || ''} onChange={setText('address')} style={inputStyle} />
          </Field>

          <SectionLabel>Payments</SectionLabel>
          <NumField label="Card" v={form.paid_card} onChange={setNum('paid_card')} />
          <NumField label="Tech cash" v={form.tech_paid_cash} onChange={setNum('tech_paid_cash')} />
          <NumField label="Company cash" v={form.paid_company_cash} onChange={setNum('paid_company_cash')} />
          <NumField label="Company check" v={form.paid_company_check} onChange={setNum('paid_company_check')} />
          <NumField label="Finance" v={form.paid_finance} onChange={setNum('paid_finance')} />
          <NumField label="LM cash" v={form.lm_cash} onChange={setNum('lm_cash')} />
          <NumField label="LM check" v={form.lm_check} onChange={setNum('lm_check')} />
          <Field label="Total (computed)"><div style={readonlyStyle}>${total.toFixed(2)}</div></Field>

          <SectionLabel>Parts</SectionLabel>
          <NumField label="Tech parts (My Parts)" v={form.tech_parts} onChange={setNum('tech_parts')} />
          <NumField label="Company parts" v={form.company_parts} onChange={setNum('company_parts')} />
          <NumField label="LM parts" v={form.lm_parts} onChange={setNum('lm_parts')} />
          <Field label="Parts total (computed)"><div style={readonlyStyle}>${partsTotal.toFixed(2)}</div></Field>

          <SectionLabel>Tips</SectionLabel>
          <NumField label="Tips on card" v={form.tips_card} onChange={setNum('tips_card')} />
          <NumField label="Tips on finance" v={form.tips_finance} onChange={setNum('tips_finance')} />
          <NumField label="Tips company cash" v={form.tips_company_cash} onChange={setNum('tips_company_cash')} />
          <NumField label="Tips on check" v={form.tips_check} onChange={setNum('tips_check')} />
          <Field label="Tips total (computed)"><div style={readonlyStyle}>${tipsTotal.toFixed(2)}</div></Field>

          <SectionLabel>Commission</SectionLabel>
          <Field label="Commission rate (%) — overrides tech default for this job only" full>
            <input
              type="text"
              inputMode="decimal"
              value={form.commission_rate ?? ''}
              onChange={setNum('commission_rate')}
              placeholder="e.g. 30 for 30%"
              style={inputStyle}
            />
          </Field>

          <Field label="Notes" full>
            <textarea
              rows={3}
              value={form.notes || ''}
              onChange={setText('notes')}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} disabled={saving} className="pmr-clear-btn">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="pmr-clear-btn"
            style={{
              background: 'rgba(99,102,241,0.18)',
              borderColor: 'rgba(99,102,241,0.5)',
              color: '#c7d2fe',
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function NumField({ label, v, onChange }: { label: string; v: number | undefined; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <Field label={label}>
      <input type="text" inputMode="decimal" value={v ?? 0} onChange={onChange} style={inputStyle} />
    </Field>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'rgba(15,23,42,0.5)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

const readonlyStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'rgba(15,23,42,0.3)', color: '#94a3b8',
  border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
};

const modalCloseStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
  color: '#94a3b8', padding: 6, borderRadius: 6, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
