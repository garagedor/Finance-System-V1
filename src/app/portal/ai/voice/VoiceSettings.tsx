"use client";

import { useEffect, useState } from "react";
import VoicePreview from "./VoicePreview";

// Voice Settings — the executive assistant's voice. Preview and choose a MALE
// premium voice, tune pacing/expressiveness, pick language, and see which
// provider + voice are live. The provider API key is never touched here; the
// browser only calls the secured server routes.

type Voice = { id: string; name: string; gender?: string; lang?: string; description?: string; provider: string };
type Settings = {
  voiceId: string | null;
  heVoiceId: string | null;
  lang: "auto" | "en" | "he";
  autoSpeak: boolean;
  speed: number;
  stability: number;
  style: number;
  narrationDetail: "concise" | "standard" | "detailed";
};
type Payload = {
  provider: string;
  configured: boolean;
  healthy: boolean;
  voices: Voice[];
  warnings?: string[];
  settings: Settings;
};

const PROVIDERS = [
  { id: "elevenlabs", name: "ElevenLabs", note: "Primary — most natural, streaming, tunable, multilingual (Hebrew-ready)." },
  { id: "cartesia", name: "Cartesia (Sonic)", note: "Optional secondary — lowest latency; limited Hebrew." },
  { id: "openai", name: "OpenAI TTS", note: "Optional — simple, few fixed voices, no fine control." },
  { id: "browser", name: "Device voice", note: "Free last-resort fallback only — robotic, device-dependent." },
];

export default function VoiceSettings({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/portal/ai/voice/voices");
        const body = await r.json().catch(() => null);
        if (!r.ok) {
          throw new Error(body?.error ? `${body.error} (HTTP ${r.status})` : `HTTP ${r.status}`);
        }
        setData(body as Payload);
        setDraft((body as Payload).settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function patch(p: Partial<Settings>) {
    setSaved(false);
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function save() {
    if (!draft || !canManage) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/portal/ai/voice/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    patch({ lang: "auto", autoSpeak: true, speed: 1.0, stability: 0.5, style: 0.3, narrationDetail: "standard" });
  }

  if (loading) return <div className="portal-subtitle">Loading voices…</div>;
  if (error && !data) return <div className="portal-card" style={{ padding: 18, color: "#fca5a5" }}>Couldn&rsquo;t load voice settings: {error}</div>;
  if (!data || !draft) return null;

  const active = PROVIDERS.find((p) => p.id === data.provider);
  const statusColor = data.configured && data.healthy ? "#34d399" : data.configured ? "#f59e0b" : "#94a3b8";
  const statusText = !data.configured
    ? "Not configured — using the device fallback voice"
    : !data.healthy
      ? "Configured, but the provider health check failed"
      : "Premium voice active";
  const previewLang: "en" | "he" = draft.lang === "he" ? "he" : "en";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {data.warnings && data.warnings.length > 0 && (
        <div className="portal-card" style={{ padding: "10px 14px", borderColor: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.08)", fontSize: 12.5, color: "#fcd9a3" }}>
          Some data couldn&rsquo;t load: {data.warnings.join("; ")}
        </div>
      )}

      {/* Provider status */}
      <div className="portal-card" style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#e2e8f0" }}>
              {active?.name ?? data.provider} <span style={{ color: "#64748b", fontWeight: 500, fontSize: 13 }}>· {statusText}</span>
            </div>
            <div className="portal-subtitle" style={{ marginTop: 2 }}>{active?.note}</div>
          </div>
        </div>
        {!data.configured && (
          <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", fontSize: 12.5, color: "#fcd9a3" }}>
            To enable the premium voice, add <code className="mono">ELEVENLABS_API_KEY</code> to <code className="mono">.env.local</code>{" "}
            (and to Vercel on deploy) and restart the dev server. The key stays on the server — never in the browser. Until then the
            assistant uses the device voice.
          </div>
        )}
      </div>

      {/* Voice picker */}
      <div className="portal-card" style={{ padding: "14px 16px" }}>
        <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Assistant voice</div>
        <div className="portal-subtitle" style={{ marginBottom: 12 }}>
          Male voices suited to a calm, confident executive. Preview each, then select one.
        </div>
        {data.voices.length === 0 ? (
          <div className="portal-subtitle">
            {data.configured ? "No voices returned by the provider." : "Connect the provider to list voices."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {data.voices.map((v, i) => {
              const selected = draft.voiceId === v.id;
              return (
                <div
                  key={v.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 6px",
                    borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => canManage && patch({ voiceId: v.id })}
                    disabled={!canManage}
                    aria-pressed={selected}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      flexShrink: 0,
                      cursor: canManage ? "pointer" : "not-allowed",
                      border: selected ? "5px solid #818cf8" : "2px solid rgba(255,255,255,0.3)",
                      background: "transparent",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#e2e8f0" }}>
                      {v.name}
                      {v.gender ? <span style={{ color: "#64748b", fontWeight: 500, fontSize: 11.5 }}> · {v.gender}</span> : null}
                    </div>
                    {v.description ? <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 1 }}>{v.description}</div> : null}
                  </div>
                  <VoicePreview voiceId={v.id} lang={previewLang} disabled={!data.configured} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tuning */}
      <div className="portal-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontWeight: 700, color: "#e2e8f0" }}>Delivery</div>

        <Slider label="Speed" value={draft.speed} min={0.7} max={1.2} step={0.05} disabled={!canManage}
          onChange={(n) => patch({ speed: n })} fmt={(n) => `${n.toFixed(2)}×`} />
        <Slider label="Stability" hint="Higher = steadier; lower = more expressive" value={draft.stability} min={0} max={1} step={0.05}
          disabled={!canManage} onChange={(n) => patch({ stability: n })} fmt={(n) => n.toFixed(2)} />
        <Slider label="Expressiveness (style)" value={draft.style} min={0} max={1} step={0.05} disabled={!canManage}
          onChange={(n) => patch({ style: n })} fmt={(n) => n.toFixed(2)} />

        <Row label="Auto-speak answers">
          <Toggle on={draft.autoSpeak} disabled={!canManage} onChange={(b) => patch({ autoSpeak: b })} />
        </Row>

        <Row label="Language">
          <Select value={draft.lang} disabled={!canManage} onChange={(v) => patch({ lang: v as Settings["lang"] })}
            options={[["auto", "Auto-detect"], ["en", "English"], ["he", "Hebrew"]]} />
        </Row>

        <Row label="Spoken detail">
          <Select value={draft.narrationDetail} disabled={!canManage} onChange={(v) => patch({ narrationDetail: v as Settings["narrationDetail"] })}
            options={[["concise", "Concise"], ["standard", "Standard"], ["detailed", "Detailed"]]} />
        </Row>

        {draft.lang === "he" && (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Hebrew uses a multilingual voice. Preview it above before relying on it — mark it good only after it reads a real
            Hebrew line naturally.
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={save} disabled={!canManage || saving} className="portal-btn"
          style={{ opacity: !canManage || saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save voice settings"}
        </button>
        <button type="button" onClick={reset} disabled={!canManage} className="portal-range-pill"
          style={{ cursor: canManage ? "pointer" : "not-allowed" }}>
          Reset to recommended
        </button>
        {saved && <span style={{ color: "#34d399", fontSize: 13 }}>Saved ✓</span>}
        {error && data && <span style={{ color: "#fca5a5", fontSize: 13 }}>{error}</span>}
        {!canManage && <span className="portal-subtitle">You need the AI manage permission to change these.</span>}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1, fontSize: 13.5, color: "#cbd5e1" }}>{label}</div>
      {children}
    </div>
  );
}

function Slider({
  label, hint, value, min, max, step, onChange, fmt, disabled,
}: {
  label: string; hint?: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void; fmt: (n: number) => string; disabled?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13.5, color: "#cbd5e1" }}>{label}</span>
        <span style={{ fontSize: 12.5, color: "#818cf8", fontFamily: "monospace" }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "#818cf8" }} />
      {hint ? <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (b: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!on)} disabled={disabled} aria-pressed={on}
      style={{
        width: 42, height: 24, borderRadius: 999, border: "none", flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        background: on ? "rgba(52,211,153,0.9)" : "rgba(255,255,255,0.14)", position: "relative", transition: "background 0.15s",
      }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
    </button>
  );
}

function Select({
  value, options, onChange, disabled,
}: {
  value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      className="portal-select" style={{ padding: "6px 10px", minWidth: 150 }}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
