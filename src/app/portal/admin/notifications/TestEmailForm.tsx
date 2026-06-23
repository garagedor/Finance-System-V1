"use client";

import { useState } from "react";

export default function TestEmailForm({ canSend }: { canSend: boolean }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/portal/admin/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Send failed");
      setMsg(`Sent. Resend id: ${j.id ?? "(none)"}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="portal-label">Send a test email to</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          required
          type="email"
          className="portal-input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
          disabled={!canSend || busy}
          style={{ flex: 1 }}
        />
        <button type="submit" className="portal-btn portal-btn-primary" disabled={!canSend || busy || !to}>
          {busy ? "Sending…" : "Send test"}
        </button>
      </div>
      {!canSend && <div className="muted small">Read-only. system:integrations:edit required to send.</div>}
      {msg && <div className="portal-alert portal-alert-info">{msg}</div>}
      {err && <div className="portal-alert portal-alert-error">{err}</div>}
    </form>
  );
}
