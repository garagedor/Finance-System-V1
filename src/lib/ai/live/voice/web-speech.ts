// Browser Web Speech API implementation of the voice interfaces. Zero
// dependencies, zero API cost, runs entirely in the browser (no audio leaves
// the device). Swap this out later by implementing the same interfaces.

import type { SpeakHandle, SpeechToText, TextToSpeech, VoiceInfo, VoiceProvider } from "./types";

/** Strip markdown so the synthesizer doesn't read "asterisk asterisk". */
function stripForSpeech(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

class WebTTS implements TextToSpeech {
  private get synth(): SpeechSynthesis | undefined {
    return typeof window !== "undefined" ? window.speechSynthesis : undefined;
  }
  speak(
    text: string,
    opts?: { voiceId?: string; lang?: string; rate?: number; onEnd?: () => void; onError?: (e: unknown) => void },
  ): SpeakHandle {
    const synth = this.synth;
    if (!synth) return { cancel() {} };
    synth.cancel();
    const u = new SpeechSynthesisUtterance(stripForSpeech(text));
    u.rate = opts?.rate ?? 1.02;
    if (opts?.lang) u.lang = opts.lang;
    const voices = synth.getVoices();
    const v =
      (opts?.voiceId && voices.find((x) => x.voiceURI === opts.voiceId)) ||
      (opts?.lang && voices.find((x) => x.lang === opts.lang)) ||
      voices.find((x) => x.lang?.startsWith("en"));
    if (v) u.voice = v;
    if (opts?.onEnd) u.onend = () => opts.onEnd!();
    if (opts?.onError) u.onerror = (e) => opts.onError!(e);
    synth.speak(u);
    return { cancel: () => synth.cancel() };
  }
  cancel(): void {
    this.synth?.cancel();
  }
  voices(): VoiceInfo[] {
    const synth = this.synth;
    if (!synth) return [];
    return synth.getVoices().map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang }));
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class WebSTT implements SpeechToText {
  private rec: any;
  readonly available: boolean;
  constructor(lang = "en-US") {
    const SR =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined;
    this.available = !!SR;
    if (SR) {
      this.rec = new SR();
      this.rec.lang = lang;
      this.rec.interimResults = true;
      this.rec.continuous = false;
    }
  }
  start(h: {
    onPartial?: (t: string) => void;
    onFinal: (t: string) => void;
    onError?: (e: unknown) => void;
    onEnd?: () => void;
  }): void {
    if (!this.rec) {
      h.onError?.(new Error("Speech recognition is not available in this browser."));
      return;
    }
    this.rec.onresult = (ev: any) => {
      let interim = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) h.onPartial?.(interim);
      if (final) h.onFinal(final.trim());
    };
    this.rec.onerror = (e: any) => h.onError?.(e);
    this.rec.onend = () => h.onEnd?.();
    try {
      this.rec.start();
    } catch (e) {
      h.onError?.(e);
    }
  }
  stop(): void {
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function createWebSpeechVoice(): VoiceProvider {
  return { id: "web-speech", tts: new WebTTS(), stt: new WebSTT() };
}
