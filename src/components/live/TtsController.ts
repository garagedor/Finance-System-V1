// Client-side TTS playback. Prefers premium audio streamed through the secured
// server route (key never in the browser); falls back to browser speech with a
// visible status. Segment-level playback → fast start + barge-in.

import { createWebSpeechVoice } from "@/lib/ai/live/voice/web-speech";
import type { VoiceProvider } from "@/lib/ai/live/voice/types";

export class TtsController {
  private gen = 0;
  private audio: HTMLAudioElement | null = null;
  private abortCtrl: AbortController | null = null;
  private browser: VoiceProvider;
  private voiceId?: string;
  private premium = false;
  /** Called when premium falls back to device voice (show a status). */
  onFallback?: (note: string) => void;

  constructor() {
    this.browser = createWebSpeechVoice();
  }

  configure(v: { configured: boolean; healthy: boolean; voiceId?: string | null }) {
    this.voiceId = v.voiceId ?? undefined;
    this.premium = !!(v.configured && v.healthy && this.voiceId);
  }
  get usingPremium() {
    return this.premium;
  }

  async speak(segment: string, lang = "en"): Promise<void> {
    const myGen = this.gen;
    if (this.premium && this.voiceId) {
      try {
        const ctrl = new AbortController();
        this.abortCtrl = ctrl;
        const res = await fetch("/api/portal/ai/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segment, voiceId: this.voiceId, lang }),
          signal: ctrl.signal,
        });
        if (myGen !== this.gen) return; // superseded / interrupted
        if (res.ok) {
          const blob = await res.blob();
          if (myGen !== this.gen) return;
          await this.playBlob(blob, myGen);
          return;
        }
        // premium unavailable → device fallback (visible, not silent)
        this.premium = false;
        this.onFallback?.("Premium voice unavailable — using device voice");
      } catch {
        if (myGen !== this.gen) return; // aborted by barge-in
        this.onFallback?.("Premium voice unavailable — using device voice");
      }
    }
    await this.browserSpeak(segment, lang, myGen);
  }

  private playBlob(blob: Blob, myGen: number): Promise<void> {
    return new Promise((resolve) => {
      if (myGen !== this.gen) return resolve();
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      this.audio = a;
      const done = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      a.play().catch(done);
    });
  }

  private browserSpeak(text: string, lang: string, myGen: number): Promise<void> {
    return new Promise((resolve) => {
      if (myGen !== this.gen) return resolve();
      const tts = this.browser.tts;
      if (!tts) {
        setTimeout(resolve, Math.min(3000, Math.max(600, text.length * 26)));
        return;
      }
      tts.speak(text, { lang: lang === "he" ? "he-IL" : "en-US", onEnd: () => resolve(), onError: () => resolve() });
    });
  }

  /** Barge-in / stop: kill current audio, abort in-flight fetch, discard queue. */
  stop() {
    this.gen++;
    this.abortCtrl?.abort();
    this.abortCtrl = null;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.browser.tts?.cancel();
  }
}
