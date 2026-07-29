import "server-only";
import { getExecutive } from "@/app/portal/ai/executives";
import { AnthropicProvider } from "./providers/anthropic";
import { ALL_TOOL_NAMES, toolsFor } from "./tools";
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
  const system = `${persona}\n\n${SHARED_RULES}${opts.live ? `\n\n${LIVE_NARRATION}` : ""}\n\nToday's date is ${today}. The company is LBS Garage Door (US, Indianapolis area).`;

  return providerFor().run({ system, messages: opts.messages, tools, ctx: opts.ctx });
}
