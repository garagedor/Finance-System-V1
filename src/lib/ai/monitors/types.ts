// Persisted shapes for the proactive engine.

import type { ScoredFinding } from "./framework";

export type { AlertSeverity } from "./framework";

/** A persisted alert = a scored finding + lifecycle fields. */
export type AlertRecord = ScoredFinding & {
  _id: string;
  date: string; // YYYY-MM-DD (generation day)
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
};

export type BriefSection = { title: string; detail: string; severity?: string };

export type BriefRecord = {
  _id: string;
  date: string;
  generatedAt: string;
  headline: string;
  overnight: string[];
  attention: BriefSection[];
  decisions: BriefSection[];
  risks: BriefSection[];
  opportunities: BriefSection[];
  doFirst: BriefSection[];
  alertCount: number;
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
};
