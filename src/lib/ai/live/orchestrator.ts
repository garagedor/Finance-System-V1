import "server-only";
import { runAssistant } from "@/lib/ai/engine";
import type { ChatMessage, ToolContext } from "@/lib/ai/types";
import { detectLang, segmentNarration } from "./voice/narration";
import { sanitizeNav, type SanitizedNav } from "./nav/capabilities";
import type { PlanStep, PresentationPlan } from "./plan-schema";

// A validated tour stop: a permission-checked destination + the line to speak
// as it opens.
type Stop = SanitizedNav & { say?: string };

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

  const session = { permissions: opts.ctx.session.permissions, type: opts.ctx.session.type };

  const textBlocks = result.blocks.filter((b): b is { type: "text"; text: string } => b.type === "text");
  const narrationRaw = textBlocks[0]?.text ?? textBlocks.map((b) => b.text).join(" ") ?? "Here's what I found.";
  const lang = detectLang(narrationRaw);
  const segments = segmentNarration(narrationRaw);

  // Assemble the PROPOSED tour: prefer the multi-stop `presentation`; fall back to
  // the single `navigation` (as a one-stop tour). Then validate EACH stop against
  // the permission-scoped allowlist — anything unknown/forbidden/out-of-schema is
  // dropped here, so the model can never drive the app outside what this user may
  // see (read-only; the client re-validates each hop again before router.push).
  const proposed =
    result.presentation && result.presentation.length
      ? result.presentation
      : result.navigation
        ? [
            {
              routeId: result.navigation.routeId,
              params: result.navigation.params,
              highlightAnchor: result.navigation.highlightAnchor,
              say: result.navigation.reason,
            },
          ]
        : [];

  const stops: Stop[] = [];
  for (const act of proposed) {
    const nav = sanitizeNav(
      { routeId: act.routeId, params: act.params, highlightAnchor: act.highlightAnchor },
      session,
    );
    if (nav) stops.push({ ...nav, say: act.say?.trim() || undefined });
  }

  const steps: PlanStep[] = [];
  if (result.blocks.length) steps.push({ type: "show_evidence", blocks: result.blocks });

  if (stops.length === 0) {
    // No tour — just narrate the answer (evidence already shown on screen).
    for (const seg of segments) steps.push({ type: "speak", text: seg, subtitle: seg, lang });
  } else {
    // Guided tour. Each stop speaks a line (its own `say`, else the next
    // narration segment), then the page moves and — once it settles — the
    // relevant figure is highlighted. A multi-stop tour opens with the first
    // narration segment as a one-line intro so the sequence has context.
    let si = 0;
    const scripted = stops.some((s) => s.say);
    if (scripted && stops.length > 1 && segments.length) {
      steps.push({ type: "speak", text: segments[si], subtitle: segments[si], lang });
      si++;
    }
    for (const stop of stops) {
      const line = stop.say ?? (si < segments.length ? segments[si++] : undefined);
      if (line) steps.push({ type: "speak", text: line, subtitle: line, lang });
      steps.push({ type: "navigate", routeId: stop.routeId, params: stop.params, reason: line });
      steps.push({ type: "pause", ms: 500 });
      if (stop.anchor) steps.push({ type: "highlight", routeId: stop.routeId, anchorId: stop.anchor });
    }
    // Any narration not consumed by a stop plays as the closing explanation.
    for (; si < segments.length; si++) {
      steps.push({ type: "speak", text: segments[si], subtitle: segments[si], lang });
    }
  }

  if (!steps.some((s) => s.type === "speak")) {
    steps.push({ type: "speak", text: "Here's what I found.", lang });
  }

  return {
    intent: opts.messages[opts.messages.length - 1]?.content ?? "",
    leadPersona: opts.executive,
    steps,
    trace: result.trace,
  };
}
