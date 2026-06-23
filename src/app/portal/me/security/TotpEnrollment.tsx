"use client";

import { useState } from "react";

interface SetupResult {
  qr_data_url: string;
  otpauth_url: string;
  backup_codes: string[];
}

export default function TotpEnrollment({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/portal/me/totp/setup", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setSetup(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/me/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setConfirmed(true);
      setInfo("2FA enabled. You'll be asked for a code at every login from now on.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!confirm("Disable 2FA? Your account will be less secure.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/me/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setInfo("2FA disabled.");
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (enabled && !confirmed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="portal-alert portal-alert-info">
          2FA is currently <strong>enabled</strong>. Sign-ins require a 6-digit code from your authenticator app.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="portal-label">Enter a current 6-digit code (or backup code) to disable</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              inputMode="numeric"
              className="portal-input"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              style={{ flex: 1, letterSpacing: 4 }}
              placeholder="123456 or AAAA-BBBB"
            />
            <button className="portal-btn" onClick={disable} disabled={busy || !disableCode} style={{ color: "#f87171" }}>
              {busy ? "…" : "Disable"}
            </button>
          </div>
        </div>
        {error && <div className="portal-alert portal-alert-error">{error}</div>}
        {info && <div className="portal-alert portal-alert-info">{info}</div>}
      </div>
    );
  }

  if (confirmed) {
    return <div className="portal-alert portal-alert-info">{info}</div>;
  }

  if (!setup) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          You&apos;ll need an authenticator app on your phone: Google Authenticator, 1Password, Authy, Bitwarden, etc.
        </p>
        <div>
          <button className="portal-btn portal-btn-primary" onClick={startEnrollment} disabled={busy}>
            {busy ? "Starting…" : "Enable 2FA"}
          </button>
        </div>
        {error && <div className="portal-alert portal-alert-error">{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <p className="portal-label">1. Scan this with your authenticator app</p>
          <img src={setup.qr_data_url} alt="2FA QR code" width={200} height={200} style={{ background: "white", padding: 8, borderRadius: 8 }} />
          <p className="muted small" style={{ marginTop: 8, maxWidth: 220, wordBreak: "break-all" }}>
            Or paste this URL manually: <code style={{ fontSize: 10 }}>{setup.otpauth_url}</code>
          </p>
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          <p className="portal-label">2. Save these backup codes</p>
          <p className="muted small">Each can be used once if you lose your phone. Print or save somewhere safe — you won&apos;t see them again.</p>
          <pre style={{ background: "#0a0f1c", padding: 12, borderRadius: 6, fontSize: 13, lineHeight: 1.8 }}>
{setup.backup_codes.join("\n")}
          </pre>
        </div>
      </div>

      <form onSubmit={confirmEnrollment} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="portal-label">3. Enter the current code from your app to finish</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            required
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="portal-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            style={{ flex: 1, letterSpacing: 4 }}
          />
          <button type="submit" className="portal-btn portal-btn-primary" disabled={busy || code.length < 6}>
            {busy ? "…" : "Confirm & enable"}
          </button>
        </div>
      </form>
      {error && <div className="portal-alert portal-alert-error">{error}</div>}
    </div>
  );
}
