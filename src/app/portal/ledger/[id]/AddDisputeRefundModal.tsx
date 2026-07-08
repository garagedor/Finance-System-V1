"use client";

// Dispute / refund entry. Pick the technician who did the job → their
// configured % prefills → share = gross × % is computed and posted as a
// positive movement (the technician owes the company their share of the loss).
// The % can be overridden per entry. The share is recomputed server-side.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface TechRate {
  name: string;
  location: string | null;
  effective_pct: number;
}

export default function AddDisputeRefundModal({
  ledgerId,
  defaultTech,
}: {
  ledgerId: string;
  defaultTech: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rates, setRates] = useState<TechRate[]>([]);

  const [type, setType] = useState<"dispute" | "refund">("dispute");
  const [tech, setTech] = useState(defaultTech);
  const [gross, setGross] = useState("");
  const [pct, setPct] = useState(""); // percent, e.g. "30"
  const [date, setDate] = useState(today());
  const [jobRef, setJobRef] = useState("");
  const [pctTouched, setPctTouched] = useState(false);

  // Load technician rates when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/portal/ledger/tech-rates")
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setRates(Array.isArray(j.rows) ? j.rows : []); })
      .catch(() => { if (!cancelled) setRates([]); });
    return () => { cancelled = true; };
  }, [open]);

  // Prefill % from the selected technician's effective rate (until the user
  // edits it themselves).
  useEffect(() => {
    if (pctTouched) return;
    const match = rates.find((r) => r.name === tech);
    if (match) setPct(String(match.effective_pct));
  }, [tech, rates, pctTouched]);

  const share = useMemo(() => {
    const g = parseFloat(gross);
    const p = parseFloat(pct);
    if (!Number.isFinite(g) || !Number.isFinite(p)) return null;
    return Math.round(g * (p / 100) * 100) / 100;
  }, [gross, pct]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const g = parseFloat(gross);
      const p = parseFloat(pct);
      if (!Number.isFinite(g)) throw new Error("Enter the gross loss amount");
      if (!Number.isFinite(p)) throw new Error("Enter the technician %");
      const res = await fetch(`/api/portal/ledger/${ledgerId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          date,
          description:
            `${type === "dispute" ? "Dispute" : "Refund"} · ${tech || "tech"}` +
            (jobRef ? ` · ${jobRef}` : ""),
          technician_id: tech || null,
          job_ref: jobRef || null,
          gross_amount: g,
          pct_applied: p / 100,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="portal-btn" onClick={() => setOpen(true)}>
        + Dispute / Refund
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 60, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              padding: 24, width: "min(560px, 95vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Dispute / Refund</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <form onSubmit={onSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label className="portal-label">Type *</label>
                  <select className="portal-select" value={type}
                    onChange={(e) => setType(e.target.value as "dispute" | "refund")} required>
                    <option value="dispute">Dispute</option>
                    <option value="refund">Refund</option>
                  </select>
                </div>
                <div>
                  <label className="portal-label">Date *</label>
                  <input type="date" className="portal-input" required value={date}
                    onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="portal-label">Technician who did the job *</label>
                <input className="portal-input" list="tech-rate-list" required value={tech}
                  onChange={(e) => { setTech(e.target.value); setPctTouched(false); }}
                  placeholder="Start typing a technician name" />
                <datalist id="tech-rate-list">
                  {rates.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name} — {r.effective_pct}%{r.location ? ` · ${r.location}` : ""}
                    </option>
                  ))}
                </datalist>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="portal-label">Gross loss (USD) *</label>
                  <input type="number" step="0.01" className="portal-input" required value={gross}
                    onChange={(e) => setGross(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="portal-label">Technician % *</label>
                  <input type="number" step="0.5" className="portal-input" required value={pct}
                    onChange={(e) => { setPct(e.target.value); setPctTouched(true); }}
                    placeholder="e.g. 30" />
                </div>
              </div>

              <div className="portal-alert" style={{ marginBottom: 14, background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.25)" }}>
                <span>Σ</span>
                <div>
                  Technician&apos;s share = gross × %{" "}
                  {share != null ? (
                    <strong className="money-pos">= +${share.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  ) : <span className="muted">— enter gross and %</span>}
                  <div className="muted small" style={{ marginTop: 2 }}>
                    Posted as positive (they owe the company their share of the loss).
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="portal-label">Job / reference (optional)</label>
                <input className="portal-input" value={jobRef}
                  onChange={(e) => setJobRef(e.target.value)} placeholder="address / job id" />
              </div>

              {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Add entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function today(): string { return new Date().toISOString().slice(0, 10); }
