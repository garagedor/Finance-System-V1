"use client";

import { useRef, useState } from "react";

// Plays a short sample line through the SECURED server TTS route (key stays
// server-side — the browser only ever receives proxied audio). One preview at a
// time: starting a new one stops any other that's playing (barge-in).
let activeAudio: HTMLAudioElement | null = null;
let activeCtrl: AbortController | null = null;

const SAMPLE: Record<string, string> = {
  en: "Good morning. Net cash across all accounts is approximately eight hundred sixty thousand dollars, and the numbers look healthy today.",
  he: "בוקר טוב. סך המזומנים בכל החשבונות הוא בערך שמונה מאות ושישים אלף דולר, והמצב נראה תקין היום.",
};

export default function VoicePreview({
  voiceId,
  lang = "en",
  disabled,
  label = "Preview",
}: {
  voiceId?: string;
  lang?: "en" | "he";
  disabled?: boolean;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const localRef = useRef<HTMLAudioElement | null>(null);

  function stopLocal() {
    if (localRef.current) {
      localRef.current.pause();
      localRef.current = null;
    }
  }

  async function play() {
    if (!voiceId || disabled) return;
    // Barge-in: stop whatever is currently previewing anywhere on the page.
    if (activeAudio) activeAudio.pause();
    activeCtrl?.abort();
    stopLocal();

    setState("loading");
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    try {
      const res = await fetch("/api/portal/ai/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segment: SAMPLE[lang] ?? SAMPLE.en, voiceId, lang }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      localRef.current = a;
      activeAudio = a;
      a.onended = () => {
        URL.revokeObjectURL(url);
        if (activeAudio === a) activeAudio = null;
        setState("idle");
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        setState("error");
      };
      setState("playing");
      await a.play().catch(() => setState("error"));
    } catch {
      if (ctrl.signal.aborted) setState("idle");
      else setState("error");
    }
  }

  function toggle() {
    if (state === "playing" || state === "loading") {
      activeCtrl?.abort();
      stopLocal();
      setState("idle");
    } else {
      void play();
    }
  }

  const text =
    state === "loading" ? "Loading…" : state === "playing" ? "◼ Stop" : state === "error" ? "Retry" : `▶ ${label}`;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!voiceId || disabled}
      className="portal-range-pill"
      style={{
        cursor: !voiceId || disabled ? "not-allowed" : "pointer",
        opacity: !voiceId || disabled ? 0.5 : 1,
        color: state === "error" ? "#fca5a5" : state === "playing" ? "#c7d2fe" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </button>
  );
}
