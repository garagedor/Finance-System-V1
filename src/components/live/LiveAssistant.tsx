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

// Wake word. When "always listen" is armed, we scan the continuous transcript for
// this phrase; on a match the assistant wakes and asks for a command. "jervis"/
// "jarvus" catch common mishears of "jarvis".
const WAKE_RE = /\b(?:hi|hey|hello|ok|okay|yo)?\s*(?:jarvis|jervis|jarvus)\b/i;
const WAKE_ACKS = ["I'm here. What's your command?", "Standing by. What do you need?", "Ready when you are — go ahead."];
type WakeState = "off" | "armed" | "awaiting" | "busy";

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
  const [briefOffer, setBriefOffer] = useState<{
    headline: string;
    alertCount: number;
    date: string;
    plan: unknown;
  } | null>(null);
  // Cinematic layer (Phase C): spotlight rect for the focused element + a
  // reduced-motion flag so we honor the OS accessibility preference.
  const [spotlight, setSpotlight] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const spotlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wake-word ("Hey JARVIS") always-listen mode. ref mirrors state for use inside
  // the recognition callbacks (which capture stale state otherwise).
  const [wakeState, setWakeState] = useState<WakeState>("off");
  const wakeModeRef = useRef(false);
  const wakeStateRef = useRef<WakeState>("off");

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

  // Respect the OS "reduce motion" preference for the animated flourishes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const h = () => setReduceMotion(mq.matches);
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, []);

  // Stop always-listening if the assistant unmounts (logout / navigation away).
  useEffect(() => {
    return () => {
      wakeModeRef.current = false;
      voiceRef.current?.stt?.stop();
    };
  }, []);

  // Proactive Morning Brief: on the first portal visit each day, quietly OFFER
  // the brief the AI already prepared (cron-precomputed). We offer a card, never
  // auto-play audio — respectful ("intelligent silence"), and browsers block
  // autoplay sound anyway. Once per day per browser via a localStorage stamp.
  useEffect(() => {
    if (!user) return;
    const p = user.permissions ?? [];
    const allowed = user.type === "admin" || p.includes("system:ai:view") || p.includes("system:ai:live");
    if (!allowed || typeof window === "undefined") return;
    if (!window.location.pathname.startsWith("/portal")) return; // portal-scoped
    const day = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("lbs.morningBriefDate") === day) return;
    let cancelled = false;
    fetch("/api/portal/ai/brief/plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.offer || !d.plan) return;
        localStorage.setItem("lbs.morningBriefDate", day); // shown today — don't re-offer
        setBriefOffer({ headline: d.headline, alertCount: d.alertCount, date: d.date, plan: d.plan });
        setOpen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  function clearSpotlight() {
    if (spotlightTimer.current) {
      clearTimeout(spotlightTimer.current);
      spotlightTimer.current = null;
    }
    setSpotlight(null);
  }

  // Scroll to an allowlisted anchor, ring it, and SPOTLIGHT it — dim the rest of
  // the page around the focused figure. The page may still be mounting after
  // router.push, so retry a few times before giving up.
  function flashAnchor(anchorId: string) {
    if (typeof document === "undefined") return;
    const tryFlash = (attempt: number) => {
      if (cancelRef.current) return;
      const el = document.getElementById(anchorId);
      if (!el) {
        if (attempt < 6) setTimeout(() => tryFlash(attempt + 1), 250);
        return;
      }
      el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      el.classList.add("ai-flash");
      setTimeout(() => el.classList.remove("ai-flash"), 2600);
      // Once the scroll settles, snapshot the element and light it up.
      setTimeout(() => {
        if (cancelRef.current) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const pad = 8;
        if (spotlightTimer.current) clearTimeout(spotlightTimer.current);
        setSpotlight({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
        spotlightTimer.current = setTimeout(() => setSpotlight(null), 3400);
      }, reduceMotion ? 60 : 480);
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
    clearSpotlight(); // leaving the page — drop any focus overlay
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
    clearSpotlight();
    setOrb("idle");
    if (wakeModeRef.current) armWake(); // stay armed for the wake word
  }

  // Morning-brief offer actions. "Play" runs the prepared presentation (voice +
  // guided tour). "Show summary" just drops the evidence into the transcript,
  // silently. "Dismiss" clears it. (The once-per-day stamp is already set.)
  function playBrief() {
    const plan = briefOffer?.plan;
    setBriefOffer(null);
    if (plan) void runPlan(plan as Parameters<typeof runPlan>[0]);
  }
  function showBriefSummary() {
    const headline = briefOffer?.headline ?? "Here's your morning brief.";
    const plan = briefOffer?.plan as { steps?: { type: string; blocks?: unknown[] }[] } | undefined;
    const blocks = plan?.steps?.find((s) => s.type === "show_evidence")?.blocks;
    setBriefOffer(null);
    if (blocks?.length) setMsgs((m) => [...m, { role: "assistant", text: headline, blocks }]);
  }
  function dismissBrief() {
    setBriefOffer(null);
  }

  // ── Wake word: "Hey JARVIS" always-listen ──────────────────────────────────
  // Continuous recognition scans for the wake phrase. On a match the assistant
  // acknowledges and waits for the command, runs it, then re-arms. The mic is
  // stopped while the assistant is speaking/answering, so it never hears itself.
  function setWake(s: WakeState) {
    wakeStateRef.current = s;
    setWakeState(s);
  }
  function startRecognition(continuous: boolean) {
    const stt = voiceRef.current?.stt;
    if (!stt) return;
    stt.start(
      {
        onPartial: (t) => {
          if (wakeStateRef.current === "awaiting") setSubtitle(t);
        },
        onFinal: (t) => onWakeFinal(t),
        onError: (e) => onWakeError(e),
        onEnd: () => onWakeEnd(),
      },
      { continuous },
    );
  }
  function armWake() {
    if (!wakeModeRef.current) return;
    voiceRef.current?.stt?.stop(); // clean state before (re)starting
    setWake("armed");
    setOrb("idle");
    setSubtitle("");
    setTimeout(() => {
      if (wakeModeRef.current && wakeStateRef.current === "armed") startRecognition(true);
    }, 150);
  }
  function commandAfter(text: string): string {
    const m = text.match(WAKE_RE);
    if (!m) return text.trim();
    return text.slice((m.index ?? 0) + m[0].length).replace(/^[\s,.:;!?-]+/, "").trim();
  }
  function onWakeFinal(text: string) {
    const state = wakeStateRef.current;
    if (state === "armed") {
      if (!WAKE_RE.test(text)) return; // ignore everything until the wake word
      voiceRef.current?.stt?.stop();
      const inline = commandAfter(text);
      if (inline.split(/\s+/).filter(Boolean).length >= 2) {
        void runWakeCommand(inline); // "hey jarvis, how are expenses" → answer directly
      } else {
        void wakeAck(); // just "hey jarvis" → acknowledge, then listen for the command
      }
    } else if (state === "awaiting") {
      voiceRef.current?.stt?.stop();
      const cmd = commandAfter(text);
      if (cmd) void runWakeCommand(cmd);
      else armWake();
    }
  }
  async function wakeAck() {
    setWake("awaiting");
    setOrb("speaking");
    const ack = WAKE_ACKS[Math.floor(Math.random() * WAKE_ACKS.length)];
    setSubtitle(ack);
    await speak(ack, "en");
    if (!wakeModeRef.current) return;
    setWake("awaiting");
    setOrb("listening");
    setSubtitle("Listening for your command…");
    startRecognition(false); // capture a single command utterance
  }
  async function runWakeCommand(text: string) {
    setWake("busy");
    setSubtitle("");
    voiceRef.current?.stt?.stop();
    await submit(text);
    if (wakeModeRef.current) armWake(); // resume listening for the wake word
    else setWake("off");
  }
  function onWakeEnd() {
    if (!wakeModeRef.current) return;
    const state = wakeStateRef.current;
    if (state === "armed") {
      setTimeout(() => {
        if (wakeModeRef.current && wakeStateRef.current === "armed") startRecognition(true);
      }, 300); // recognition times out on silence — restart to stay armed
    } else if (state === "awaiting") {
      setSubtitle("");
      armWake(); // no command heard — back to waiting for the wake word
    }
    // "busy": runWakeCommand re-arms after the answer finishes.
  }
  function onWakeError(e: unknown) {
    const err = (e as { error?: string })?.error;
    if (err === "not-allowed" || err === "service-not-allowed") {
      disableWake();
      setError("Microphone access is blocked. Allow the mic to use “Hey JARVIS.”");
    }
    // "no-speech" / "aborted" / "network" are benign — onEnd restarts.
  }
  function enableWake() {
    if (!voiceRef.current?.stt?.available) {
      setError("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    wakeModeRef.current = true;
    setError(null);
    setOpen(true);
    armWake();
  }
  function disableWake() {
    wakeModeRef.current = false;
    voiceRef.current?.stt?.stop();
    setSubtitle("");
    setWake("off");
    setOrb("idle");
  }
  function toggleWake() {
    if (wakeModeRef.current) disableWake();
    else enableWake();
  }

  const wakeActive = wakeState === "armed" || wakeState === "awaiting";
  const color = wakeActive ? STATE_COLOR.listening : STATE_COLOR[orb];
  const statusText =
    wakeState === "armed"
      ? "Listening for “Hey JARVIS”…"
      : wakeState === "awaiting"
        ? "Listening…"
        : STATE_LABEL[orb];

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
          animation: orb === "idle" || reduceMotion ? undefined : "aiPulse 1.4s ease-in-out infinite",
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
            {orb === "speaking" ? (
              <Waveform color={color} reduceMotion={reduceMotion} />
            ) : (
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e2e8f0" }}>AI Executive</div>
              <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {statusText} · <span style={{ color: "#818cf8" }}>{voiceLabel}</span>{" "}
                <Link href="/portal/ai/voice" style={{ color: "#64748b", textDecoration: "underline" }}>settings</Link>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleWake}
              title={
                wakeActive
                  ? "Always-listening on — say “Hey JARVIS”. Click to turn off."
                  : "Turn on always-listening — then just say “Hey JARVIS”"
              }
              style={{
                ...iconBtn,
                background: wakeActive ? "rgba(52,211,153,0.22)" : "rgba(255,255,255,0.06)",
                boxShadow: wakeActive ? "0 0 0 1px rgba(52,211,153,0.5)" : undefined,
              }}
            >
              👂
            </button>
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

          {/* Proactive Morning Brief offer (once per day) */}
          {briefOffer && (
            <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(245,158,11,0.08)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fcd9a3", marginBottom: 4 }}>☀️ Good morning</div>
              <div style={{ fontSize: 12.5, color: "#e2e8f0", lineHeight: 1.5, marginBottom: 9 }}>
                {briefOffer.headline}
                {briefOffer.alertCount > 0 && (
                  <> · <b>{briefOffer.alertCount}</b> item{briefOffer.alertCount === 1 ? "" : "s"} flagged.</>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={playBrief} className="portal-btn portal-btn-primary" style={{ fontSize: 12 }}>
                  ▶ Walk me through it
                </button>
                <button type="button" onClick={showBriefSummary} className="portal-btn" style={{ fontSize: 12 }}>
                  Show summary
                </button>
                <button type="button" onClick={dismissBrief} className="portal-btn" style={{ fontSize: 12 }}>
                  Dismiss
                </button>
              </div>
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

          {/* Controls */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            style={{ display: "flex", gap: 7, padding: 11, borderTop: "1px solid rgba(255,255,255,0.08)", alignItems: "center" }}
          >
            {wakeState === "off" && (
              <button type="button" onClick={toggleMic} title="Voice input" style={{ ...iconBtn, background: orb === "listening" ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.06)" }}>
                🎙
              </button>
            )}
            {(orb === "speaking" || orb === "thinking" || orb === "listening") && (
              <button type="button" onClick={stopAll} title="Stop" style={{ ...iconBtn, background: "rgba(248,113,113,0.18)" }}>■</button>
            )}
            <input className="portal-input" style={{ flex: 1 }} placeholder="Ask your executive team…" value={input} onChange={(e) => setInput(e.target.value)} />
            <button type="submit" className="portal-btn portal-btn-primary" disabled={!input.trim()}>Send</button>
          </form>
        </div>
      )}

      {/* Cinematic spotlight — dims the page around the focused figure */}
      {spotlight && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            zIndex: 55,
            pointerEvents: "none",
            borderRadius: 12,
            boxShadow:
              "0 0 0 9999px rgba(3,7,18,0.55), 0 0 0 2px rgba(129,140,248,0.9), 0 0 26px 6px rgba(129,140,248,0.45)",
            transition: reduceMotion ? "none" : "top 0.35s ease, left 0.35s ease, width 0.35s ease, height 0.35s ease",
            animation: reduceMotion ? undefined : "aiSpotIn 0.3s ease",
          }}
        />
      )}

      {/* Cinematic caption — narration centered over the whole screen while speaking */}
      {subtitle && (
        <div
          style={{
            position: "fixed",
            bottom: 92,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 58,
            maxWidth: "min(680px, calc(100vw - 120px))",
            padding: "10px 18px",
            borderRadius: 12,
            background: "rgba(8,12,24,0.82)",
            border: "1px solid rgba(129,140,248,0.3)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            color: "#e8edfb",
            fontSize: 15,
            lineHeight: 1.45,
            textAlign: "center",
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            animation: reduceMotion ? undefined : "aiCaptionIn 0.25s ease",
          }}
        >
          {subtitle}
        </div>
      )}

      <style>{`@keyframes aiPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes aiWave { 0%,100% { height: 4px; opacity: 0.6; } 50% { height: 13px; opacity: 1; } }
@keyframes aiSpotIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes aiCaptionIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
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

// Subtle audio-style waveform shown while the assistant is speaking. Purely
// decorative (aria-hidden); static bars when the user prefers reduced motion.
function Waveform({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  return (
    <span aria-hidden style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 13, width: 20 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            height: reduceMotion ? 9 : 4,
            borderRadius: 2,
            background: color,
            animation: reduceMotion ? undefined : `aiWave 0.9s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
