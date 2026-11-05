"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/portal/scanpay/invoice-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
}

export function SuggestionActions({ invoiceNumber, open, candidates }: {
  invoiceNumber: string;
  open: boolean;
  candidates: Array<{ jobId: string; label: string; sub: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try { await post(body); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {candidates.map((c) => (
        <div key={c.jobId} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div className="small">{c.label}</div>
            {c.sub && <div className="muted small">{c.sub}</div>}
          </div>
          {open && (
            <button type="button" className="portal-btn portal-btn-primary" disabled={busy} onClick={() => act({ action: "link", invoiceNumber, jobId: c.jobId })}>
              Link
            </button>
          )}
        </div>
      ))}
      {open && (
        <div>
          <button type="button" className="portal-btn" disabled={busy} onClick={() => act({ action: "dismiss", invoiceNumber })}>None of these</button>
        </div>
      )}
      {err && <div className="portal-alert portal-alert-error">{err}</div>}
    </div>
  );
}

export function RunAutoLinkButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const j = await post({ action: "run" });
      setMsg(`${j.result?.linked ?? 0} linked · ${j.result?.suggestions ?? 0} waiting`);
      router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Run failed"); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {msg && <span className="muted small">{msg}</span>}
      <button type="button" className="portal-btn portal-btn-primary" onClick={run} disabled={busy}>{busy ? "Linking… (up to 2 min)" : "Run auto-link now"}</button>
    </div>
  );
}
