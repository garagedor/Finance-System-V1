// Provider-independent voice architecture. The assistant depends only on these
// interfaces — never on a specific voice engine. The first implementation uses
// the browser Web Speech API; a cloud/realtime provider can be added later by
// implementing the same interfaces, with zero changes to the assistant.

export type VoiceInfo = { id: string; name: string; lang: string };

export interface SpeakHandle {
  cancel(): void;
}

export interface TextToSpeech {
  /** Speak text. Returns a handle to cancel. */
  speak(
    text: string,
    opts?: { voiceId?: string; lang?: string; rate?: number; onEnd?: () => void; onError?: (e: unknown) => void },
  ): SpeakHandle;
  /** Cancel any current speech immediately (barge-in / stop). */
  cancel(): void;
  voices(): VoiceInfo[];
}

export interface SpeechToText {
  /** Start listening. Emits partial + final transcripts. `continuous` keeps the
   *  session open across utterances (used for always-on wake-word listening). */
  start(
    handlers: {
      onPartial?: (text: string) => void;
      onFinal: (text: string) => void;
      onError?: (e: unknown) => void;
      onEnd?: () => void;
    },
    opts?: { continuous?: boolean },
  ): void;
  stop(): void;
  readonly available: boolean;
}

// Reserved for a future realtime, full-duplex voice provider (true barge-in).
export interface RealtimeVoice {
  connect(): Promise<void>;
  disconnect(): void;
}

export interface VoiceProvider {
  id: string;
  tts?: TextToSpeech;
  stt?: SpeechToText;
  realtime?: RealtimeVoice;
}
