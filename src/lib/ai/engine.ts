import "server-only";
import { getExecutive } from "@/app/portal/ai/executives";
import { AnthropicProvider } from "./providers/anthropic";
import { ALL_TOOL_NAMES, toolsFor } from "./tools";
import { navigableRoutesFor } from "./live/nav/capabilities";
import type { AgentResult, ChatMessage, ToolContext } from "./types";

// The engine is provider-independent: it resolves the active provider, gives it
// the persona + the permitted tools, and returns structured blocks + a trace.
// Switching providers later = changing the one line that constructs the
// provider (or reading a PROVIDER env var), nothing else.

const SHARED_RULES = `You are READ-ONLY. You may analyze, explain, summarize, compare, and recommend — but you must NOT create, update, delete, or execute anything. Those actions happen later through the Action Center after human approval.

Rules for every answer:
- Never invent or estimate numbers. Every figure must come from a tool result. If you don't have a tool for something, say so plainly.
- If data is missing, stale, or a bank hasn't synced recently, say so explicitly — do not paper over it.
- Be specific about scope: which date range, which location/technician/area manager, which data you used.
- Think and act like a seasoned executive: lead with the answer, then the evidence, then a concrete recommended next step.
- You MUST deliver your final answer by calling the present_report tool with visual blocks (text + KPI cards + charts + tables + recommendations + alerts) — never as plain chat text.`;

function providerFor(): AnthropicProvider {
  // Single provider today (Anthropic). To add OpenAI/Gemini later, branch on an
  // AI_PROVIDER env var here — the engine and tools stay unchanged.
  return new AnthropicProvider();
}

const LIVE_NARRATION = `LIVE VOICE MODE: the owner will HEAR your answer, not read it. Make the FIRST text block a spoken narration — 2 to 5 short, conversational sentences a senior executive would say out loud. Verbalize numbers and money in words (e.g. "approximately eight hundred sixty-one thousand dollars"), keep it concise, and use NO markdown, symbols, emoji, URLs, or table syntax in that first block. Put all the exact figures, KPI cards, tables, and long lists in the LATER blocks (those are shown on screen only, not spoken).`;

const LIVE_NAV_HEADER = `LIVE NAVIGATION: You may take the owner to a page so they can SEE the evidence while you talk. Only when opening a specific page would materially help them see THIS answer, include a "navigation" object in present_report: a routeId from the list below, optionally "params" using only that route's listed filter keys, optionally a "highlightAnchor" from that route's listed ids, and a one-sentence "reason" to say out loud. Do NOT navigate for greetings, casual questions, or when the on-screen blocks already suffice. Never use a routeId, filter key, or anchor that is not listed. Navigable pages for this user:`;

/** Build the live navigation allowlist prompt from what THIS session may open. */
function buildNavPrompt(ctx: ToolContext): string {
  const routes = navigableRoutesFor({ permissions: ctx.session.permissions, type: ctx.session.type });
  if (routes.length === 0) return "";
  const lines = routes.map((r) => {
    const parts = [`${r.routeId} — ${r.label}`];
    if (r.params.length) parts.push(`filters: ${r.params.join(", ")}`);
    if (r.anchors.length) parts.push(`highlight ids: ${r.anchors.join(", ")}`);
    return `- ${parts.join("  |  ")}`;
  });
  return `${LIVE_NAV_HEADER}\n${lines.join("\n")}`;
}

export async function runAssistant(opts: {
  executive?: string;
  messages: ChatMessage[];
  ctx: ToolContext;
  live?: boolean;
}): Promise<AgentResult> {
  const exec = opts.executive ? getExecutive(opts.executive) : undefined;
  const persona =
    exec?.systemPrompt ??
    "You are the AI executive team for LBS Garage Door. Answer as whichever executive is most relevant to the question.";
  const allow = exec?.tools ?? ALL_TOOL_NAMES;
  const tools = toolsFor(allow, opts.ctx);

  const today = new Date().toISOString().slice(0, 10);
  const navPrompt = opts.live ? buildNavPrompt(opts.ctx) : "";
  const system = `${persona}\n\n${SHARED_RULES}${opts.live ? `\n\n${LIVE_NARRATION}` : ""}${navPrompt ? `\n\n${navPrompt}` : ""}\n\nToday's date is ${today}. The company is LBS Garage Door (US, Indianapolis area).`;

  // Live voice mode is latency-critical: run at LOW reasoning effort so the
  // model makes fewer, more-consolidated tool calls and starts answering fast.
  // The deterministic DB tools do the heavy financial work; the model only
  // orchestrates + narrates, which low effort handles well. The full-report
  // (non-live) path keeps the model's default (high) for maximum rigor.
  return providerFor().run({
    system,
    messages: opts.messages,
    tools,
    ctx: opts.ctx,
    ...(opts.live ? { effort: "low" as const } : {}),
  });
}
