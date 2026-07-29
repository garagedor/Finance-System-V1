import type { AiBlock, Trace } from "@/lib/ai/types";

// The Presentation Plan. The orchestrator returns this instead of prose; the
// client Presentation Director executes it one step at a time. Phase 1 uses the
// speak / show_evidence / ask subset; navigation/highlight/propose_action steps
// arrive in later phases (kept in the union so the schema is forward-stable).

export type PlanStep =
  | { type: "speak"; text: string; subtitle?: string; lang?: string }
  | { type: "show_evidence"; blocks: AiBlock[] }
  | { type: "ask"; question: string; options?: string[] }
  // ── Phase 2+ (declared now; not emitted yet) ──
  | { type: "navigate"; routeId: string; params?: Record<string, string>; reason?: string }
  | { type: "apply_filter"; routeId: string; filterKey: string; value: string }
  | { type: "highlight"; routeId: string; anchorId: string; note?: string }
  | { type: "pause"; ms?: number }
  | { type: "propose_action"; draft: Record<string, unknown> };

export type PresentationPlan = {
  intent: string;
  leadPersona?: string;
  steps: PlanStep[];
  trace?: Trace;
};
