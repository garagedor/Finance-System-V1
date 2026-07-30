"use client";

// The global JARVIS orb (Phase 1: Live Assistant Foundation). Persists across
// route changes because it's mounted in AuthShell. Read-only: it speaks answers
// and shows evidence — no navigation or writes yet.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthShell";
import Link from "next/link";
import { createWebSpeechVoice } from "@/lib/ai/live/voice/web-speech";
import type { VoiceProvider } from "@/lib/ai/live/voice/types";
import { sanitizeNav, hrefFor, resolveCapability } from "@/lib/ai/live/nav/capabilities";
import { TtsController } from "./TtsController";
import AiBlocksLite from "./AiBlocksLite";

// Instant spoken acknowledgements played the moment a question is submitted, so
// the assistant starts talking within ~200ms instead of after the model's
// multi-second reasoning. Rotated for variety; matched to the question's language.
const LEAD_INS_EN = ["One moment…", "Let me pull that up.", "Looking into that now…", "On it — checking the numbers.", "Give me a second…"];
const LEAD_INS_HE = ["רגע אחד…", "בודק את זה…", "מסתכל על הנתונים…"];

type OrbState = "idle" | "listening" | "thinking" | "speaking";
type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; blocks?: unknown[]; question?: string };

const STATE_COLOR: Record<OrbState, string> = {
  idle: "#6366f1",
  listening: "#34d399",
  thinking: "#f59e0b",
  speaking: "#818cf8",
};
const STATE_LABEL: Record<OrbState, string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export default function LiveAssistant() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [orb, setOrb] = useState<OrbState>("idle");
  const [muted, setMuted] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [subtitle, setSubtitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [voiceLabel, setVoiceLabel] = useState("Device voice");
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [navEnabled, setNavEnabled] = useState(true);
  const navEnabledRef = useRef(true);
  const voiceRef = useRef<VoiceProvider | null>(null);
  const ttsRef = useRef<TtsController | null>(null);
  const sessionIdRef = useRef<string>("");
  const cancelRef = useRef(false);
  const listeningRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!voiceRef.current) voiceRef.current = createWebSpeechVoice();
    if (!ttsRef.current) {
      const t = new TtsController();
      t.onFallback = (note) => setFallbackNote(note);
      ttsRef.current = t;
    }
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now()}`;
    }
    // Load premium-voice status + settings.
    fetch("/api/portal/ai/voice/voices")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const premium = !!(d.configured && d.healthy && d.settings?.voiceId);
        ttsRef.current?.configure({ configured: d.configured, healthy: d.healthy, voiceId: d.settings?.voiceId });
        if (premium) {
          const v = (d.voices ?? []).find((x: { id: string; name: string }) => x.id === d.settings.voiceId);
          setVoiceLabel(`${d.provider}${v?.name ? ` · ${v.name}` : ""}`);
        } else if (d.configured) {
          setVoiceLabel("No voice selected");
        } else {
          setVoiceLabel("Device voice (fallback)");
        }
        if (typeof d.settings?.autoSpeak === "boolean") setMuted(!d.settings.autoSpeak);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  }, [msgs, subtitle]);

  // Show for authenticated AI-permitted users everywhere in the app (finance
  // portal AND the legacy CRM) — the orb is self-contained, so it answers from
  // any page. It stays hidden only for users without AI access / when logged out.
  const perms = user?.permissions ?? [];
  const canUse =
    !!user && (user.type === "admin" || perms.includes("system:ai:view") || perms.includes("system:ai:live"));
  if (!canUse) return null;

  function speak(text: string, lang = "en"): Promise<void> {
    if (muted) return new Promise((resolve) => setTimeout(resolve, Math.min(2500, Math.max(600, text.length * 22))));
    return ttsRef.current?.speak(text, lang) ?? Promise.resolve();
  }

  function navSession() {
    return { permissions: user?.permissions ?? [], type: user?.type };
  }

  // Scroll to and briefly flash an allowlisted anchor. The page may still be
  // mounting after router.push, so retry a few times before giving up.
  function flashAnchor(anchorId: string) {
    if (typeof document === "undefined") return;
    const tryFlash = (attempt: number) => {
      if (cancelRef.current) return;
      const el = document.getElementById(anchorId);
      if (!el) {
        if (attempt < 6) setTimeout(() => tryFlash(attempt + 1), 250);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ai-flash");
      setTimeout(() => el.classList.remove("ai-flash"), 2200);
    };
    tryFlash(0);
  }

  // Navigate — but only after client-side re-validation against the same
  // permission-scoped allowlist the server used (defense in depth), and only
  // when the session has navigation enabled.
  function doNavigate(routeId: string, params?: Record<string, string>) {
    if (!navEnabledRef.current) return;
    const nav = sanitizeNav({ routeId, params }, navSession());
    if (!nav) return;
    const label = resolveCapability(nav.routeId)?.label ?? "the page";
    setSubtitle(`Opening ${label}…`);
    router.push(hrefFor(nav.routeId, nav.params));
  }

  async function runPlan(plan: {
    steps: {
      type: string;
      text?: string;
      blocks?: unknown[];
      question?: string;
      lang?: string;
      routeId?: string;
      params?: Record<string, string>;
      anchorId?: string;
      filterKey?: string;
      value?: string;
      ms?: number;
    }[];
  }) {
    cancelRef.current = false;
    // one assistant message we fill in as steps run
    let assistantText = "";
    let assistantBlocks: unknown[] | undefined;
    let assistantQuestion: string | undefined;
    setMsgs((m) => [...m, { role: "assistant", text: "" }]);
    const commit = () =>
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          text: assistantText.trim(),
          blocks: assistantBlocks,
          question: assistantQuestion,
        };
        return copy;
      });

    for (const step of plan.steps) {
      if (cancelRef.current) break;
      if (step.type === "speak" && step.text) {
        setOrb("speaking");
        setSubtitle(step.text);
        assistantText += (assistantText ? " " : "") + step.text;
        commit();
        await speak(step.text, step.lang || "en");
        setSubtitle("");
      } else if (step.type === "show_evidence" && step.blocks) {
        assistantBlocks = step.blocks;
        commit();
      } else if (step.type === "ask" && step.question) {
        assistantQuestion = step.question;
        assistantText += (assistantText ? " " : "") + step.question;
        commit();
        setOrb("speaking");
        setSubtitle(step.question);
        await speak(step.question, step.lang || "en");
        setSubtitle("");
      } else if (step.type === "navigate" && step.routeId) {
        doNavigate(step.routeId, step.params);
      } else if (step.type === "apply_filter" && step.routeId && step.filterKey) {
        doNavigate(step.routeId, { [step.filterKey]: step.value ?? "" });
      } else if (step.type === "highlight" && step.anchorId) {
        if (navEnabledRef.current) flashAnchor(step.anchorId);
      } else if (step.type === "pause") {
        await new Promise((r) => setTimeout(r, Math.min(2000, step.ms ?? 400)));
      }
    }
    setOrb("idle");
  }

  async function submit(text: string) {
    const clean = text.trim();
    if (!clean || orb === "thinking") return;
    setError(null);
    setInput("");
    const history: Msg[] = [...msgs, { role: "user", text: clean }];
    setMsgs(history);
    setOrb("thinking");
    // Speak an instant lead-in (fire-and-forget) so there's no dead air while the
    // model reasons. It finishes long before the plan returns; the real narration
    // then plays via runPlan. Honors mute (speak() no-ops when muted).
    const leadLang = /[֐-׿]/.test(clean) ? "he" : "en";
    const leadPool = leadLang === "he" ? LEAD_INS_HE : LEAD_INS_EN;
    void speak(leadPool[Math.floor(Math.random() * leadPool.length)], leadLang);
    try {
      const res = await fetch("/api/portal/ai/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          messages: history.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error || `Request failed (${res.status})`);
      }
      const plan = await res.json();
      await runPlan(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setOrb("idle");
    }
  }

  function toggleMic() {
    const v = voiceRef.current;
    if (!v?.stt?.available) {
      setError("Voice input isn't supported in this browser. You can type instead.");
      return;
    }
    if (listeningRef.current) {
      v.stt.stop();
      listeningRef.current = false;
      setOrb("idle");
      return;
    }
    listeningRef.current = true;
    setOrb("listening");
    setError(null);
    v.stt.start({
      onPartial: (t) => setInput(t),
      onFinal: (t) => {
        listeningRef.current = false;
        submit(t);
      },
      onError: () => {
        listeningRef.current = false;
        setOrb("idle");
        setError("Didn't catch that.");
      },
      onEnd: () => {
        listeningRef.current = false;
        if (orb === "listening") setOrb("idle");
      },
    });
  }

  function stopAll() {
    cancelRef.current = true;
    ttsRef.current?.stop();
    voiceRef.current?.stt?.stop();
    listeningRef.current = false;
    setSubtitle("");
    setOrb("idle");
  }

  const color = STATE_COLOR[orb];

  return (
    <>
      {/* Floating orb button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="AI executive assistant"
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          zIndex: 60,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          background: `radial-gradient(circle at 35% 30%, ${color}, #0d1526 78%)`,
          boxShadow: `0 0 0 1px ${color}55, 0 8px 28px ${color}44`,
          animation: orb === "idle" ? undefined : "aiPulse 1.4s ease-in-out infinite",
        }}
      >
        <span style={{ fontSize: 22 }}>🤖</span>
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            right: 22,
            bottom: 88,
            zIndex: 60,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "min(72vh, 640px)",
            display: "flex",
            flexDirection: "column",
            borderRadius: 16,
            overflow: "hidden",
            background: "#0d1526",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e2e8f0" }}>AI Executive</div>
              <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {STATE_LABEL[orb]} · <span style={{ color: "#818cf8" }}>{voiceLabel}</span>{" "}
                <Link href="/portal/ai/voice" style={{ color: "#64748b", textDecoration: "underline" }}>settings</Link>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !navEnabledRef.current;
                navEnabledRef.current = next;
                setNavEnabled(next);
              }}
              title={navEnabled ? "Navigation on — JARVIS can open pages for you" : "Navigation off — voice + evidence only"}
              style={{ ...iconBtn, opacity: navEnabled ? 1 : 0.45 }}
            >
              🧭
            </button>
            <button type="button" onClick={() => setMuted((m) => !m)} title={muted ? "Voice off" : "Voice on"} style={iconBtn}>
              {muted ? "🔇" : "🔊"}
            </button>
            <button type="button" onClick={() => setOpen(false)} title="Minimize" style={iconBtn}>—</button>
          </div>
          {fallbackNote && (
            <div style={{ padding: "6px 14px", fontSize: 11, color: "#fcd9a3", background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.25)" }}>
              {fallbackNote}
            </div>
          )}

          {/* Transcript */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {msgs.length === 0 && (
              <div style={{ color: "#94a3b8", fontSize: 12.5, lineHeight: 1.7 }}>
                Ask me anything about the business, out loud or by typing. I&apos;ll answer and show the evidence.
                <div style={{ marginTop: 10, color: "#64748b", fontSize: 11.5 }}>
                  Try: &ldquo;How much can I safely spend today?&rdquo;
                </div>
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", padding: "8px 11px", borderRadius: 11, fontSize: 12.5, background: "rgba(99,102,241,0.16)", border: "1px solid rgba(99,102,241,0.28)", color: "#e0e7ff" }}>
                  {m.text}
                </div>
              ) : (
                <div key={i} style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: 8 }}>
                  {m.text && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{m.text}</p>}
                  {m.blocks && m.blocks.length > 0 && <AiBlocksLite blocks={m.blocks as never} />}
                </div>
              ),
            )}
            {orb === "thinking" && <div style={{ color: "#64748b", fontSize: 12 }}>Thinking…</div>}
            {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}
          </div>

          {/* Live subtitle while speaking */}
          {subtitle && (
            <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 12, color: "#c7d2fe", background: "rgba(99,102,241,0.06)" }}>
              {subtitle}
            </div>
          )}

          {/* Controls */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            style={{ display: "flex", gap: 7, padding: 11, borderTop: "1px solid rgba(255,255,255,0.08)", alignItems: "center" }}
          >
            <button type="button" onClick={toggleMic} title="Voice input" style={{ ...iconBtn, background: orb === "listening" ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.06)" }}>
              🎙
            </button>
            {(orb === "speaking" || orb === "thinking" || orb === "listening") && (
              <button type="button" onClick={stopAll} title="Stop" style={{ ...iconBtn, background: "rgba(248,113,113,0.18)" }}>■</button>
            )}
            <input className="portal-input" style={{ flex: 1 }} placeholder="Ask your executive team…" value={input} onChange={(e) => setInput(e.target.value)} />
            <button type="submit" className="portal-btn portal-btn-primary" disabled={!input.trim()}>Send</button>
          </form>
        </div>
      )}

      <style>{`@keyframes aiPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes aiFlash { 0%,100% { box-shadow: 0 0 0 0 rgba(129,140,248,0); } 35% { box-shadow: 0 0 0 3px rgba(129,140,248,0.9), 0 0 22px 6px rgba(129,140,248,0.5); } }
.ai-flash { animation: aiFlash 1.1s ease-in-out 2; outline: 2px solid rgba(129,140,248,0.75); outline-offset: 3px; border-radius: 12px; }`}</style>
    </>
  );
}

const iconBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
  background: "rgba(255,255,255,0.06)",
  color: "#cbd5e1",
  fontSize: 13,
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};
