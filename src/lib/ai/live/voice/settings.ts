import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";

export type NarrationDetail = "concise" | "standard" | "detailed";

export type VoiceSettings = {
  _id: "voice";
  provider?: string;
  voiceId?: string; // English/default voice
  heVoiceId?: string; // Hebrew voice (must genuinely support Hebrew)
  lang: "auto" | "en" | "he";
  autoSpeak: boolean;
  speed: number;
  stability: number;
  style: number;
  narrationDetail: NarrationDetail;
};

export const VOICE_DEFAULTS: VoiceSettings = {
  _id: "voice",
  lang: "auto",
  autoSpeak: true,
  speed: 1.0,
  stability: 0.5,
  style: 0.3,
  narrationDetail: "standard",
};

// Atlas occasionally drops a TLS handshake mid-connection ("SSL alert number 80")
// under Node 24, especially right after a dev-server restart. These reads/writes
// are idempotent, so a couple of quick retries smooth over the transient flake.
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry transient TLS/connection errors — fail fast on real errors.
      if (!/SSL|TLS|ENOTFOUND|querySrv|EAI_AGAIN|ECONNRESET|ETIMEDOUT|topology|pool|socket/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getVoiceSettings(): Promise<VoiceSettings> {
  return withRetry(async () => {
    await ensureFinanceIndexes();
    const d = await coll<VoiceSettings>(FINANCE_COLLECTIONS.aiVoiceSettings).findOne({ _id: "voice" });
    return { ...VOICE_DEFAULTS, ...(d ?? {}) };
  });
}

export async function setVoiceSettings(patch: Partial<VoiceSettings>): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "_id") continue;
    if (v !== undefined) set[k] = v;
  }
  if (Object.keys(set).length === 0) return;
  await withRetry(async () => {
    await ensureFinanceIndexes();
    await coll<VoiceSettings>(FINANCE_COLLECTIONS.aiVoiceSettings).updateOne({ _id: "voice" }, { $set: set }, { upsert: true });
  });
}
