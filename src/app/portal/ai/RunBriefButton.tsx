"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Triggers a fresh Morning Brief + alert scan on demand, then refreshes the page.
export default function RunBriefButton({ label = "Run brief now" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/portal/ai/brief/run", { method: "POST" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to run brief");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {err && <span style={{ color: "#f87171", fontSize: 12 }}>{err}</span>}
      <button type="button" className="portal-btn portal-btn-primary" onClick={run} disabled={busy}>
        {busy ? "Analyzing…" : label}
      </button>
    </div>
  );
}
