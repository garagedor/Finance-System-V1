import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";

// Live-session audit. Records what the assistant did — never audio, never keys.
// Transcripts are stored only as the command + which tools/pages were used.

export type LiveSessionRow = {
  _id: string;
  sessionId: string;
  userName: string;
  command: string;
  leadPersona?: string;
  toolsUsed: string[];
  pagesOpened?: string[];
  model?: string;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number };
  createdAt: string;
};

export async function appendLiveSession(row: Omit<LiveSessionRow, "_id" | "createdAt">): Promise<void> {
  try {
    await ensureFinanceIndexes();
    await coll<LiveSessionRow>(FINANCE_COLLECTIONS.aiSession).insertOne({
      _id: newId("aisess"),
      createdAt: new Date().toISOString(),
      ...row,
    });
  } catch (e) {
    console.error("[ai-live] session log failed:", e);
  }
}

// Voice (TTS) usage — characters + estimated cost per synthesized segment.
export type VoiceUsageRow = {
  _id: string;
  kind: "voice";
  userName: string;
  chars: number;
  estCost: number;
  provider: string;
  voiceId: string;
  createdAt: string;
};

export async function appendVoiceUsage(row: Omit<VoiceUsageRow, "_id" | "kind" | "createdAt">): Promise<void> {
  try {
    await ensureFinanceIndexes();
    await coll<VoiceUsageRow>(FINANCE_COLLECTIONS.aiSession).insertOne({
      _id: newId("aivoice"),
      kind: "voice",
      createdAt: new Date().toISOString(),
      ...row,
    });
  } catch (e) {
    console.error("[ai-live] voice usage log failed:", e);
  }
}
