'use client';

import { useState } from 'react';
import { FiX, FiAlertTriangle, FiDollarSign, FiLoader } from 'react-icons/fi';

type DisputeRefundModalProps = {
    jobId: string;
    onClose: () => void;
    onSuccess?: () => void;
};

export function DisputeRefundModal({ jobId, onClose, onSuccess }: DisputeRefundModalProps) {
    const [step, setStep] = useState<'choose' | 'amount'>('choose');
    const [type, setType] = useState<'dispute' | 'refund' | null>(null);
    const [amount, setAmount] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChoose = (choice: 'dispute' | 'refund') => {
        setType(choice);
        setStep('amount');
        setError(null);
    };

    const handleSubmit = async () => {
        if (!type) return;

        const numAmount = Number(amount);
        if (!amount || Number.isNaN(numAmount) || numAmount <= 0) {
            setError('Please enter a valid amount greater than 0');
            return;
        }

        setSaving(true);
        setError(null);

        const payload = type === 'refund'
            ? { jobId, refundTotal: numAmount }
            : { jobId, totalDisputed: numAmount };

        const endpoint = type === 'refund' ? '/api/refunds' : '/api/disputes';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setError(err?.error || `Failed to create ${type}`);
                return;
            }

            onSuccess?.();
            onClose();
        } catch (err) {
            console.error(`Failed to create ${type}`, err);
            setError(`Failed to create ${type}`);
        } finally {
            setSaving(false);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="modal-container">
                <div className="modal-header">
                    <h2 className="modal-title">
                        {step === 'choose' ? 'Create Dispute or Refund' : type === 'refund' ? 'Enter Refund Amount' : 'Enter Dispute Amount'}
                    </h2>
                    <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
                        <FiX />
                    </button>
                </div>

                <div className="modal-body">
                    {step === 'choose' ? (
                        <div className="choice-buttons">
                            <button className="choice-btn dispute" onClick={() => handleChoose('dispute')}>
                                <FiAlertTriangle className="choice-icon" />
                                <span className="choice-label">Dispute</span>
                                <span className="choice-desc">Report a dispute for this job</span>
                            </button>
                            <button className="choice-btn refund" onClick={() => handleChoose('refund')}>
                                <FiDollarSign className="choice-icon" />
                                <span className="choice-label">Refund</span>
                                <span className="choice-desc">Create a refund for this job</span>
                            </button>
                        </div>
                    ) : (
                        <div className="amount-form">
                            <label className="amount-label">
                                {type === 'refund' ? 'Refund Total' : 'Total Disputed'}
                            </label>
                            <div className="amount-input-wrap">
                                <span className="currency-symbol">$</span>
                                <input
                                    type="number"
                                    className="amount-input"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    step="0.01"
                                    min="0"
                                    autoFocus
                                />
                            </div>
                            {error && <div className="error-message">{error}</div>}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    {step === 'amount' && (
                        <button className="modal-btn modal-btn-back" onClick={() => setStep('choose')} disabled={saving}>
                            Back
                        </button>
                    )}
                    <div className="modal-footer-spacer" />
                    <button className="modal-btn modal-btn-cancel" onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    {step === 'amount' && (
                        <button className="modal-btn modal-btn-save" onClick={handleSubmit} disabled={saving || !amount}>
                            {saving ? <FiLoader className="spin" /> : null}
                            {saving ? 'Creating...' : `Create ${type === 'refund' ? 'Refund' : 'Dispute'}`}
                        </button>
                    )}
                </div>
            </div>

            <style jsx>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 24px;
        }

        .modal-container {
          background: white;
          border-radius: 16px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          max-width: 480px;
          width: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid #e2e8f0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }

        .modal-title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: white;
          letter-spacing: -0.3px;
        }

        .modal-close-btn {
          background: rgba(255, 255, 255, 0.2);
          border: none;
          border-radius: 8px;
          padding: 8px;
          cursor: pointer;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.2s;
        }

        .modal-close-btn:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .modal-body {
          padding: 24px;
        }

        .choice-buttons {
          display: flex;
          gap: 16px;
        }

        .choice-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 24px 16px;
          border-radius: 12px;
          border: 2px solid #e2e8f0;
          background: #f8fafc;
          cursor: pointer;
          transition: all 0.2s;
        }

        .choice-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
        }

        .choice-btn.dispute:hover {
          border-color: #fbbf24;
          background: #fffbeb;
        }

        .choice-btn.refund:hover {
          border-color: #10b981;
          background: #ecfdf5;
        }

        .choice-icon {
          font-size: 28px;
        }

        .choice-btn.dispute .choice-icon {
          color: #f59e0b;
        }

        .choice-btn.refund .choice-icon {
          color: #10b981;
        }

        .choice-label {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
        }

        .choice-desc {
          font-size: 12px;
          color: #64748b;
          text-align: center;
        }

        .amount-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .amount-label {
          font-size: 14px;
          font-weight: 600;
          color: #334155;
        }

        .amount-input-wrap {
          display: flex;
          align-items: center;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          background: #f8fafc;
          overflow: hidden;
          transition: all 0.2s;
        }

        .amount-input-wrap:focus-within {
          border-color: #667eea;
          background: white;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
        }

        .currency-symbol {
          padding: 14px 0 14px 16px;
          font-size: 18px;
          font-weight: 600;
          color: #64748b;
        }

        .amount-input {
          flex: 1;
          padding: 14px 16px 14px 8px;
          border: none;
          background: transparent;
          font-size: 18px;
          font-weight: 600;
          color: #0f172a;
          outline: none;
        }

        .amount-input::placeholder {
          color: #94a3b8;
        }

        .error-message {
          color: #dc2626;
          font-size: 13px;
          font-weight: 500;
        }

        .modal-footer {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 24px;
          border-top: 1px solid #e2e8f0;
          background: #f8fafc;
        }

        .modal-footer-spacer {
          flex: 1;
        }

        .modal-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .modal-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .modal-btn-back {
          background: white;
          color: #64748b;
          border: 1px solid #e2e8f0;
        }

        .modal-btn-back:hover:not(:disabled) {
          background: #f1f5f9;
        }

        .modal-btn-cancel {
          background: white;
          color: #64748b;
          border: 1px solid #e2e8f0;
        }

        .modal-btn-cancel:hover:not(:disabled) {
          background: #f1f5f9;
          border-color: #cbd5e1;
        }

        .modal-btn-save {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .modal-btn-save:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        :global(.spin) {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
}
