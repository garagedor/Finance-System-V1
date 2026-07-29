import "server-only";
import { runAssistant } from "@/lib/ai/engine";
import type { ChatMessage, ToolContext } from "@/lib/ai/types";
import { detectLang, segmentNarration } from "./voice/narration";
import type { PlanStep, PresentationPlan } from "./plan-schema";

// Live orchestrator: reuses the read-only engine in "live" mode so the model
// writes a conversational spoken narration (first text block) DISTINCT from the
// detailed on-screen blocks. The narration is cleaned + segmented for streaming
// TTS; the evidence is shown on screen.
export async function buildLivePlan(opts: {
  executive?: string;
  messages: ChatMessage[];
  ctx: ToolContext;
}): Promise<PresentationPlan> {
  const result = await runAssistant({ ...opts, live: true });

  const textBlocks = result.blocks.filter((b): b is { type: "text"; text: string } => b.type === "text");
  const narrationRaw = textBlocks[0]?.text ?? textBlocks.map((b) => b.text).join(" ") ?? "Here's what I found.";
  const lang = detectLang(narrationRaw);
  const segments = segmentNarration(narrationRaw);

  const steps: PlanStep[] = [];
  if (result.blocks.length) steps.push({ type: "show_evidence", blocks: result.blocks });
  for (const seg of segments) steps.push({ type: "speak", text: seg, subtitle: seg, lang });
  if (steps.length === 0) steps.push({ type: "speak", text: "Here's what I found.", lang });

  return {
    intent: opts.messages[opts.messages.length - 1]?.content ?? "",
    leadPersona: opts.executive,
    steps,
    trace: result.trace,
  };
}
