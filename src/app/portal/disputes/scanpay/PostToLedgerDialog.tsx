"use client";

// "Post → ledger" for a ScanPay inbox item. Opens a small dialog to pick WHICH
// ledger and WHICH party's slice to charge — the same choice as adding a
// dispute/refund from inside a ledger — then posts via the confirm action. The
// resulting ledger entry is identical to the in-ledger flow (party slice +
// breakdown). Leave the ledger on "Area Manager's (automatic)" for the default.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Ledger = { _id: string; holder_name: string; role: string; location: string };
type Party = "combined" | "technician" | "area_manager" | "provider";
const PARTIES: [Party, string][] = [["combined", "AM + Technician"], ["technician", "Technician"], ["area_manager", "Area Manager"], ["provider", "Provider"]];
const roleLabel = (r: string) => r === "area_manager" ? "Area Manager" : r === "technician" ? "Technician" : r.replace(/_/g, " ");

export default function PostToLedgerDialog({ endpoint, label = "Post → ledger" }: { endpoint: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [ledgerId, setLedgerId] = useState("");
  const [party, setParty] = useState<Party>("combined");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/portal/ledger?status=active&pageSize=2000")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const rows: Array<Record<string, unknown>> = Array.isArray(j) ? j : (j.rows ?? []);
        setLedgers(rows.map((x) => ({ _id: String(x._id ?? ""), holder_name: String(x.holder_name ?? ""), role: String(x.role ?? ""), location: String(x.location ?? "") })).filter((l) => l._id));
      })
      .catch(() => { if (!cancelled) setLedgers([]); });
    return () => { cancelled = true; };
  }, [open]);

  async function post() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", ledgerId: ledgerId || undefined, party }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to post");
    } finally { setBusy(false); }
  }

  return (
    <>
      <button className="portal-btn portal-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 60, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 20, width: "min(520px, 96vw)", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#f1f5f9" }}>Post to ledger</h3>
              <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setOpen(false)}>✕</button>
            </div>

            <label className="portal-label">Ledger</label>
            <select className="portal-input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} style={{ marginBottom: 14 }}>
              <option value="">Area Manager&apos;s ledger (automatic)</option>
              {ledgers.map((l) => (
                <option key={l._id} value={l._id}>{l.holder_name}{l.role ? ` · ${roleLabel(l.role)}` : ""}{l.location ? ` · ${l.location}` : ""}</option>
              ))}
            </select>

            <label className="portal-label">Charge which party&apos;s slice?</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {PARTIES.map(([v, l]) => (
                <button key={v} type="button" className={`portal-btn ${party === v ? "portal-btn-primary" : "portal-btn-ghost"}`} style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setParty(v)}>{l}</button>
              ))}
            </div>
            <div className="muted small" style={{ marginBottom: 12 }}>
              Posts the chosen slice as a ledger entry — same as adding it from inside the ledger (with the full cost-share breakdown). Technician uses the job&apos;s tech %.
            </div>

            {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="portal-btn portal-btn-primary" onClick={post} disabled={busy}>{busy ? "Posting…" : "Post to ledger"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
