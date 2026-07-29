import "server-only";
import type { ServerTtsProvider, TtsRenderSettings, TtsVoice } from "../server-types";

// ElevenLabs premium TTS via raw HTTPS (no SDK dependency). The API key is read
// from the environment on the server and never leaves it.

const BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2"; // quality + Hebrew; override per-request

function apiKey(): string {
  return process.env.ELEVENLABS_API_KEY?.trim() || "";
}

export function elevenLabsConfigured(): boolean {
  return !!apiKey();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class ElevenLabsProvider implements ServerTtsProvider {
  readonly id = "elevenlabs";

  supportsStreaming(): boolean {
    return true;
  }
  supportsLanguage(lang: string): boolean {
    // multilingual v2 covers English + Hebrew (among ~29 languages)
    return ["en", "he"].includes(lang);
  }
  estimateCost(chars: number): number {
    // Rough estimate (~$0.30 / 1,000 chars on standard tiers). Label as estimate.
    return (chars / 1000) * 0.3;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!apiKey()) return { ok: false, detail: "ELEVENLABS_API_KEY not set" };
    try {
      const r = await fetch(`${BASE}/user/subscription`, { headers: { "xi-api-key": apiKey() } });
      return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "connection error" };
    }
  }

  async getVoices(): Promise<TtsVoice[]> {
    if (!apiKey()) return [];
    const r = await fetch(`${BASE}/voices`, { headers: { "xi-api-key": apiKey() } });
    if (!r.ok) return [];
    const j: any = await r.json();
    return (j.voices ?? []).map((v: any) => ({
      id: v.voice_id,
      name: v.name,
      gender: v.labels?.gender,
      lang: v.labels?.language,
      description: [v.labels?.accent, v.labels?.description, v.labels?.use_case].filter(Boolean).join(" · ") || undefined,
      previewUrl: v.preview_url,
      provider: this.id,
    }));
  }

  private async call(
    path: string,
    text: string,
    opts: { voiceId: string; settings?: TtsRenderSettings; signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>> {
    if (!apiKey()) throw new Error("ElevenLabs is not configured (no ELEVENLABS_API_KEY).");
    const s = opts.settings ?? {};
    const voiceSettings: Record<string, unknown> = {
      stability: clamp(s.stability ?? 0.5, 0, 1),
      similarity_boost: clamp(s.similarity ?? 0.75, 0, 1),
      style: clamp(s.style ?? 0.3, 0, 1),
      use_speaker_boost: true,
    };
    if (typeof s.speed === "number") voiceSettings.speed = clamp(s.speed, 0.7, 1.2);
    const r = await fetch(
      `${BASE}/text-to-speech/${opts.voiceId}${path}?optimize_streaming_latency=3&output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: s.modelId || DEFAULT_MODEL, voice_settings: voiceSettings }),
        signal: opts.signal,
      },
    );
    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed (${r.status}): ${detail.slice(0, 160)}`);
    }
    return r.body as ReadableStream<Uint8Array>;
  }

  stream(text: string, opts: { voiceId: string; lang?: string; settings?: TtsRenderSettings; signal?: AbortSignal }) {
    return this.call("/stream", text, opts);
  }
  synthesize(text: string, opts: { voiceId: string; lang?: string; settings?: TtsRenderSettings; signal?: AbortSignal }) {
    return this.call("", text, opts);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
