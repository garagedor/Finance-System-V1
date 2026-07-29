import "server-only";
import type { ServerTtsProvider } from "./server-types";
import { ElevenLabsProvider, elevenLabsConfigured } from "./providers/elevenlabs";

// Provider factory + configurable fallback chain. Order is driven by
// AI_VOICE_PROVIDER; if the chosen provider isn't configured, we fall through.
// If none is configured, returns null → the client uses browser TTS (fallback).

export function configuredProviderId(): string {
  return process.env.AI_VOICE_PROVIDER?.trim().toLowerCase() || "elevenlabs";
}

export function resolveTts(): ServerTtsProvider | null {
  // Only ElevenLabs is implemented today; Cartesia/OpenAI slot in here later.
  if (elevenLabsConfigured()) return new ElevenLabsProvider();
  return null;
}

export function voiceProviderStatus(): { provider: string; configured: boolean } {
  return { provider: configuredProviderId(), configured: elevenLabsConfigured() };
}
