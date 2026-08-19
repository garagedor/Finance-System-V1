'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { FiX, FiSave, FiLoader, FiTrash2 } from 'react-icons/fi';
import type { ColumnConfig } from '@/app/utils/jobUtils';

interface RowEditModalProps<T> {
  row: T;
  columns: ColumnConfig<T>[];
  isNew: boolean;
  onSave: (row: T) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
  title?: string;
  /** When set, the user's custom field order for this form is saved under
   *  `${orderKey}:formOrder` in localStorage (per-device). */
  orderKey?: string;
}

export function RowEditModal<T extends Record<string, any>>({
  row,
  columns,
  isNew,
  onSave,
  onDelete,
  onClose,
  title = 'Edit Row',
  orderKey,
}: RowEditModalProps<T>) {
  const [formData, setFormData] = useState<T>({ ...row });
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setFormData({ ...row });
    setValidationError(null);
  }, [row]);

  const handleFieldChange = (key: keyof T, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setValidationError(null);  // Clear error on field change
  };

  const handleSave = async () => {
    // Validate required fields for new rows
    if (isNew) {
      const idColumn = columns.find((c) => c.key === '_id');
      if (idColumn && idColumn.editable !== false) {
        const id = (formData as any)._id;
        if (!id || String(id).trim() === '') {
          const fieldName = idColumn.label || 'ID';
          setValidationError(`The "${fieldName}" field is required`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const editableColumns = columns.filter(
    (col) => col.type !== 'chip' && (col.type !== 'password' || isNew) && col.editable !== false && !(col.key === '_id' && !isNew)
  );

  // ── Custom field order (drag-to-reorder, saved per device) ────────────────
  const editableKeys = useMemo(() => editableColumns.map((c) => String(c.key)), [editableColumns]);
  const editableSig = editableKeys.join('|');
  const formOrderKey = orderKey ? `${orderKey}:formOrder` : null;
  const [reordering, setReordering] = useState(false);
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    let saved: string[] = [];
    if (typeof window !== 'undefined' && formOrderKey) {
      try { saved = JSON.parse(localStorage.getItem(formOrderKey) || '[]'); } catch { /* ignore */ }
    }
    const valid = saved.filter((k) => editableKeys.includes(k));
    return [...valid, ...editableKeys.filter((k) => !valid.includes(k))];
  });
  // Keep the order reconciled when the column set changes (added/removed fields).
  useEffect(() => {
    setFieldOrder((prev) => {
      const valid = prev.filter((k) => editableKeys.includes(k));
      const merged = [...valid, ...editableKeys.filter((k) => !valid.includes(k))];
      return merged.length === prev.length && merged.every((k, i) => k === prev[i]) ? prev : merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableSig]);
  // Persist.
  useEffect(() => {
    if (formOrderKey && typeof window !== 'undefined') {
      try { localStorage.setItem(formOrderKey, JSON.stringify(fieldOrder)); } catch { /* ignore */ }
    }
  }, [formOrderKey, fieldOrder]);

  const orderedColumns = useMemo(() => {
    const byKey = new Map(editableColumns.map((c) => [String(c.key), c]));
    return fieldOrder.map((k) => byKey.get(k)).filter(Boolean) as ColumnConfig<T>[];
  }, [fieldOrder, editableColumns]);

  const dragIndex = useRef<number | null>(null);
  const moveField = (from: number | null, to: number) => {
    if (from == null || from === to) return;
    setFieldOrder((prev) => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };
  const resetOrder = () => setFieldOrder(editableKeys);

  const renderField = (col: ColumnConfig<T>) => {
    const value = formData[col.key];
    const commonProps = {
      className: 'modal-input',
      id: `field-${String(col.key)}`,
      placeholder: col.placeholder,
    };

    switch (col.type) {
      case 'select':
        return (
          <select
            {...commonProps}
            value={value ?? ''}
            onChange={(e) => handleFieldChange(col.key, e.target.value)}
          >
            <option value="">Select...</option>
            {(col.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case 'boolean':
        return (
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={!!value}
              onChange={() => handleFieldChange(col.key, !value)}
            />
            <span className="toggle-slider"></span>
          </label>
        );
      case 'multiline':
        return (
          <textarea
            {...commonProps}
            rows={3}
            value={value ?? ''}
            onChange={(e) => handleFieldChange(col.key, e.target.value)}
          />
        );
      case 'date':
        return (
          <input
            {...commonProps}
            type="date"
            value={value ?? ''}
            onChange={(e) => handleFieldChange(col.key, e.target.value)}
          />
        );
      case 'currency':
      case 'number':
        return (
          <input
            {...commonProps}
            type="number"
            step="0.01"
            value={value ?? 0}
            onChange={(e) => handleFieldChange(col.key, e.target.value)}
          />
        );
      case 'password':
        return (
          <input
            {...commonProps}
            type="text"
            value={value ?? ''}
            onChange={(e) => handleFieldChange(col.key, e.target.value)}
          />
        );
      default:
        return (
          <input
            {...commonProps}
            type="text"
            value={value ?? ''}
            onChange={(e) => handleFieldChange(col.key, e.target.value)}
          />
        );
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-container">
        <div className="modal-header">
          <h2 className="modal-title">{isNew ? 'Add New Row' : title}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {editableColumns.length > 1 && (
              <button className="modal-reorder-btn" onClick={() => setReordering((v) => !v)} title="Reorder the fields in this form">
                {reordering ? '✓ Done' : '⇅ Reorder fields'}
              </button>
            )}
            <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
              <FiX />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {reordering ? (
            <div className="reorder-panel">
              <p className="reorder-note">Drag fields to change the order they appear in this form. Saved on this device.</p>
              <ul className="reorder-list">
                {orderedColumns.map((col, i) => (
                  <li
                    key={String(col.key)}
                    className="reorder-item"
                    draggable
                    onDragStart={() => { dragIndex.current = i; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { moveField(dragIndex.current, i); dragIndex.current = null; }}
                    onDragEnd={() => { dragIndex.current = null; }}
                  >
                    <span className="reorder-grip">⠿</span>
                    <span className="reorder-name">{col.label}</span>
                  </li>
                ))}
              </ul>
              <div className="reorder-actions">
                <button className="modal-btn modal-btn-cancel" onClick={resetOrder}>Reset to default</button>
                <button className="modal-btn modal-btn-save" onClick={() => setReordering(false)}>Done</button>
              </div>
            </div>
          ) : (
            <div className="modal-form-grid">
              {orderedColumns.map((col) => (
                <div
                  key={String(col.key)}
                  className={`modal-field ${col.type === 'boolean' ? 'modal-field-boolean' : ''} ${col.highlight ? 'modal-field-highlight' : ''}`}
                >
                  <label className="modal-label" htmlFor={`field-${String(col.key)}`}>
                    {col.label}
                  </label>
                  {renderField(col)}
                  {col.hint && <span className="modal-hint">{col.hint}</span>}
                </div>
              ))}
            </div>
          )}
          {validationError && (
            <div className="modal-validation-error">
              {validationError}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {!isNew && onDelete && (
            <button
              className="modal-btn modal-btn-delete"
              onClick={() => {
                if (confirm('Delete this row?')) {
                  onDelete();
                  onClose();
                }
              }}
              disabled={saving}
            >
              <FiTrash2 />
              Delete
            </button>
          )}
          <div className="modal-footer-spacer" />
          <button className="modal-btn modal-btn-cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="modal-btn modal-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? <FiLoader className="spin" /> : <FiSave />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <style jsx>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 24px;
          animation: modalBackdropIn 0.2s ease-out;
        }

        @keyframes modalBackdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .modal-container {
          background: #111827;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.04);
          max-width: 700px;
          width: 100%;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: modalIn 0.28s cubic-bezier(0.22, 1, 0.36, 1);
          transform-origin: center;
        }

        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 22px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          background: linear-gradient(180deg, rgba(99, 102, 241, 0.08), transparent);
          position: relative;
        }

        .modal-header::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          bottom: -1px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.5), transparent);
        }

        .modal-title {
          margin: 0;
          font-size: 17px;
          font-weight: 700;
          color: #f1f5f9;
          letter-spacing: -0.3px;
        }

        .modal-close-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 7px;
          cursor: pointer;
          color: #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .modal-close-btn:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
          color: #f87171;
        }

        .modal-body {
          padding: 22px;
          overflow-y: auto;
          flex: 1;
        }

        .modal-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
        }

        .modal-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .modal-field-boolean {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }

        .modal-field-highlight {
          border: 1px solid rgba(99, 102, 241, 0.4);
          background: rgba(99, 102, 241, 0.07);
          border-radius: 12px;
          padding: 12px 14px;
        }

        .modal-field-highlight .modal-label {
          color: #a5b4fc;
        }

        .modal-hint {
          font-size: 11px;
          color: #a5b4fc;
          line-height: 1.4;
        }

        .modal-reorder-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 6px 11px;
          font-size: 12px;
          font-weight: 600;
          color: #a5b4fc;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .modal-reorder-btn:hover {
          border-color: rgba(99, 102, 241, 0.45);
          color: #c7d2fe;
        }

        .reorder-note {
          font-size: 12px;
          color: #94a3b8;
          margin: 0 0 14px;
        }
        .reorder-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .reorder-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: #1a2236;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 9px;
          cursor: grab;
          user-select: none;
          transition: border-color 0.15s, background 0.15s;
        }
        .reorder-item:hover {
          border-color: rgba(99, 102, 241, 0.4);
          background: #1e2740;
        }
        .reorder-item:active {
          cursor: grabbing;
        }
        .reorder-grip {
          color: #64748b;
          font-size: 15px;
          line-height: 1;
        }
        .reorder-name {
          font-size: 13px;
          color: #f1f5f9;
        }
        .reorder-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }

        .modal-validation-error {
          margin-top: 14px;
          padding: 10px 14px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: 10px;
          color: #f87171;
          font-size: 13px;
          font-weight: 500;
        }

        .modal-label {
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .modal-input {
          padding: 9px 13px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          font-size: 13px;
          font-family: inherit;
          background: #1a2236;
          color: #f1f5f9;
          transition: all 0.2s;
          width: 100%;
          box-sizing: border-box;
        }

        .modal-input::placeholder {
          color: #475569;
        }

        .modal-input:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        textarea.modal-input {
          resize: vertical;
          min-height: 80px;
        }

        select.modal-input {
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 32px;
        }

        select.modal-input option {
          background: #1a2236;
          color: #f1f5f9;
        }

        .toggle-switch {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          padding: 6px 0;
        }

        .toggle-switch input {
          position: absolute;
          opacity: 0;
          width: 0;
          height: 0;
        }

        .toggle-slider {
          position: relative;
          width: 42px;
          height: 24px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 24px;
          transition: all 0.3s ease;
          flex-shrink: 0;
        }

        .toggle-slider::before {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 18px;
          height: 18px;
          background: #94a3b8;
          border-radius: 50%;
          transition: all 0.3s ease;
        }

        .toggle-switch input:checked + .toggle-slider {
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          border-color: rgba(99, 102, 241, 0.5);
        }

        .toggle-switch input:checked + .toggle-slider::before {
          background: white;
          transform: translateX(18px);
          box-shadow: 0 2px 6px rgba(99, 102, 241, 0.5);
        }

        .modal-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 22px;
          border-top: 1px solid rgba(255, 255, 255, 0.07);
          background: #0d1526;
        }

        .modal-footer-spacer {
          flex: 1;
        }

        .modal-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 8px 18px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .modal-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .modal-btn-cancel {
          background: rgba(255, 255, 255, 0.05);
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .modal-btn-cancel:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(255, 255, 255, 0.18);
          color: #f1f5f9;
        }

        .modal-btn-save {
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          color: white;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
        }

        .modal-btn-save:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(99, 102, 241, 0.5);
        }

        .modal-btn-delete {
          background: rgba(239, 68, 68, 0.1);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.25);
        }

        .modal-btn-delete:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.18);
          border-color: rgba(239, 68, 68, 0.45);
          color: #fca5a5;
        }

        :global(.spin) {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
