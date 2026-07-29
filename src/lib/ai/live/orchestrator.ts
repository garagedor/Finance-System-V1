import "server-only";
import { runAssistant } from "@/lib/ai/engine";
import type { ChatMessage, ToolContext } from "@/lib/ai/types";
import { detectLang, segmentNarration } from "./voice/narration";
import { sanitizeNav } from "./nav/capabilities";
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

  // Validate the model's PROPOSED navigation against the permission-scoped
  // allowlist. Anything unknown/forbidden/out-of-schema is dropped here — the
  // model can never drive the app outside what this user may see (read-only).
  const nav = result.navigation
    ? sanitizeNav(result.navigation, {
        permissions: opts.ctx.session.permissions,
        type: opts.ctx.session.type,
      })
    : null;

  const steps: PlanStep[] = [];
  if (result.blocks.length) steps.push({ type: "show_evidence", blocks: result.blocks });

  // Speak the lead-in, then move — so JARVIS is talking while the page loads.
  if (nav) {
    const reason = result.navigation?.reason?.trim();
    if (reason) steps.push({ type: "speak", text: reason, subtitle: reason, lang });
    steps.push({ type: "navigate", routeId: nav.routeId, params: nav.params, reason });
    steps.push({ type: "pause", ms: 500 });
  }

  // Narrate the answer; flash the highlighted figure right after the first line.
  segments.forEach((seg, i) => {
    steps.push({ type: "speak", text: seg, subtitle: seg, lang });
    if (nav?.anchor && i === 0) steps.push({ type: "highlight", routeId: nav.routeId, anchorId: nav.anchor });
  });
  if (nav?.anchor && segments.length === 0) {
    steps.push({ type: "highlight", routeId: nav.routeId, anchorId: nav.anchor });
  }

  if (steps.length === 0) steps.push({ type: "speak", text: "Here's what I found.", lang });

  return {
    intent: opts.messages[opts.messages.length - 1]?.content ?? "",
    leadPersona: opts.executive,
    steps,
    trace: result.trace,
  };
}
