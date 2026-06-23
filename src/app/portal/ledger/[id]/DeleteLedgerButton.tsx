"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteLedgerButton({
  ledgerId,
  holderName,
  entryCount,
}: {
  ledgerId: string;
  holderName: string;
  entryCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doDelete() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portal/ledger/${ledgerId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      router.push("/portal/ledger");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="portal-btn portal-btn-ghost"
        style={{ color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}
        onClick={() => setOpen(true)}
      >
        Delete ledger
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 80,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(248,113,113,0.35)", borderRadius: 14,
              padding: 24, width: "min(460px, 92vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>
              Delete {holderName}&apos;s ledger?
            </h2>
            <p className="small" style={{ color: "#cbd5e1", lineHeight: 1.6, marginTop: 0 }}>
              This permanently deletes the ledger and all{" "}
              <strong>{entryCount.toLocaleString()}</strong> of its entries (reports, payments,
              disputes, everything). This <strong>cannot be undone</strong>. You can then create a
              fresh ledger for this person from the list.
            </p>

            {err && <div className="portal-alert portal-alert-error" style={{ margin: "10px 0" }}>{err}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="portal-btn"
                style={{ background: "#dc2626", color: "#fff", borderColor: "#dc2626" }}
                onClick={doDelete}
                disabled={busy}
              >
                {busy ? "Deleting…" : `Delete ledger + ${entryCount} entries`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
