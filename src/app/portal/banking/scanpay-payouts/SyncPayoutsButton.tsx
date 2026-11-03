"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncPayoutsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/portal/scanpay/payouts/sync", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setMsg(`${j.sync?.payouts ?? 0} payouts checked · ${j.refunds?.filled ?? 0} refund amounts filled`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {msg && <span className="muted small">{msg}</span>}
      <button type="button" className="portal-btn portal-btn-primary" onClick={run} disabled={busy}>
        {busy ? "Syncing… (up to 2 min)" : "Sync payouts now"}
      </button>
    </div>
  );
}
