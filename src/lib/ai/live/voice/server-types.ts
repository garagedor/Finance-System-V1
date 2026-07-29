// Server-side premium TTS provider abstraction. The route, orchestrator, orb,
// and Presentation Director depend only on this — never on ElevenLabs directly.
// A new provider = one file implementing this interface.

export type TtsVoice = {
  id: string;
  name: string;
  gender?: string;
  lang?: string;
  previewUrl?: string;
  description?: string;
  provider: string;
};

export type TtsRenderSettings = {
  stability?: number;
  style?: number;
  speed?: number;
  similarity?: number;
  modelId?: string;
};

export interface ServerTtsProvider {
  readonly id: string;
  /** Full (non-streamed) audio for a segment. Returns an mp3 byte stream. */
  synthesize(
    text: string,
    opts: { voiceId: string; lang?: string; settings?: TtsRenderSettings; signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;
  /** Low-latency streamed audio for a segment. Returns an mp3 byte stream. */
  stream(
    text: string,
    opts: { voiceId: string; lang?: string; settings?: TtsRenderSettings; signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>>;
  getVoices(): Promise<TtsVoice[]>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
  /** Estimated USD cost for N characters (label as estimate). */
  estimateCost(chars: number): number;
  supportsLanguage(lang: string): boolean;
  supportsStreaming(): boolean;
}
