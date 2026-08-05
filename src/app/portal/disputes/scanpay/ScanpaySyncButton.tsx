"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Summary {
  fetched: number; created: number; updated: number;
  matchedByInvoice: number; matchedByFallback: number; unmatched: number; preserved: number;
}

export default function ScanpaySyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function sync() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/api/portal/scanpay/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      const s = j.summary as Summary;
      setMsg(`Pulled ${s.fetched} · ${s.created} new · ${s.matchedByInvoice} by invoice · ${s.matchedByFallback} suggested · ${s.unmatched} unmatched`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {msg && <span className="muted small">{msg}</span>}
      {err && <span className="small" style={{ color: "#f87171" }}>{err}</span>}
      <button className="portal-btn portal-btn-primary" onClick={sync} disabled={busy}>
        {busy ? "Syncing…" : "↻ Sync ScanPay"}
      </button>
    </div>
  );
}
