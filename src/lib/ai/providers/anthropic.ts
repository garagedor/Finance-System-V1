import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, resolveModel } from "../model";
import type {
  AgentResult,
  AiBlock,
  AiProvider,
  NavIntent,
  PresentationAct,
  ProviderRunInput,
  SynthesisInput,
  SynthesisResult,
  ToolCallTrace,
  ToolDef,
  Trace,
} from "../types";

const MAX_ITERATIONS = 8;
const MAX_TOKENS = 16000;

// The tool the model MUST call last to deliver its structured answer. Its input
// IS the rich, non-chat-only response (cards, charts, tables, recommendations).
const PRESENT_TOOL: Anthropic.Tool = {
  name: "present_report",
  description:
    "Call this exactly once, as your FINAL step, to deliver your answer. Do not answer in plain text — every answer is delivered through this tool as a sequence of visual blocks.",
  input_schema: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        description:
          "Ordered blocks the UI renders. Each is an object with a `type` and its fields. Supported types: " +
          '{type:"text", text} | ' +
          '{type:"kpis", items:[{label, value, delta?, tone?:"pos"|"neg"|"neutral"}]} | ' +
          '{type:"table", title?, columns:[string], rows:[[string|number]]} | ' +
          '{type:"chart", chartType:"line"|"bar", title?, xKey, series:[{key,label}], data:[object]} | ' +
          '{type:"recommendations", items:[{title, detail, priority?:"high"|"medium"|"low"}]} | ' +
          '{type:"alerts", items:[{severity:"high"|"medium"|"low"|"info", title, detail}]}. ' +
          "Lead with a short text block that answers directly, then supporting cards/charts, then recommendations. Never invent numbers — every figure must come from a tool result.",
        items: { type: "object" },
      },
      trace: {
        type: "object",
        description: "How you derived the answer, for the traceability panel.",
        properties: {
          dateRange: { type: "string", description: "The exact date range used, e.g. 2026-07-01..2026-07-29" },
          location: { type: "string" },
          technician: { type: "string" },
          areaManager: { type: "string" },
          sources: { type: "array", items: { type: "string" }, description: "Which datasets/tools informed the answer" },
          notes: { type: "string", description: "Any caveats — stale data, missing info, assumptions." },
        },
      },
      navigation: {
        type: "object",
        description:
          "OPTIONAL. Only in live voice mode, and only when opening a SINGLE page would materially help the owner SEE this answer, include a navigation. Use ONLY a routeId from the allowlist provided in the system prompt — never invent a path. It is a suggestion; it is validated server-side and dropped if not permitted. For an answer with several places worth showing in sequence, use `presentation` instead.",
        properties: {
          routeId: { type: "string", description: "An exact routeId from the allowlist, e.g. /portal/expenses" },
          params: {
            type: "object",
            description: "Optional URL filters for that route, using only the filter keys the allowlist lists for it.",
          },
          highlightAnchor: {
            type: "string",
            description: "Optional anchor id to highlight on the destination page (only ids the allowlist lists for that route).",
          },
          reason: { type: "string", description: "One short spoken sentence, e.g. 'Let me pull up your expenses.'" },
        },
      },
      presentation: {
        type: "array",
        description:
          "OPTIONAL, live voice mode only. A GUIDED TOUR: an ORDERED list of stops that walks the owner through the real pages so they SEE the answer unfold, instead of a single hop. Use it when the answer has more than one place worth showing in sequence (e.g. open the dashboard, then filtered expenses, then a specific report). Each item is an object: " +
          '{routeId (an exact routeId from the allowlist), params? (only that route\'s listed filter keys), highlightAnchor? (only that route\'s listed ids), say? (one short spoken sentence for THIS stop, e.g. "Now look at Chicago\'s expenses.")}. ' +
          "Use ONLY allowlisted routeIds / params / anchors — every stop is validated server-side and silently dropped if not permitted (read-only: you can view and highlight, never change anything). Prefer this over `navigation` when there is more than one place to look; use neither for greetings or when the on-screen blocks already suffice. At most ~6 stops.",
        items: { type: "object" },
      },
    },
    required: ["blocks"],
  },
};

function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
  const defs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  return [...defs, PRESENT_TOOL];
}

const KNOWN_BLOCK_TYPES = new Set(["text", "kpis", "table", "chart", "recommendations", "alerts"]);

function sanitizeBlocks(raw: unknown): AiBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is AiBlock =>
      !!b && typeof b === "object" && KNOWN_BLOCK_TYPES.has((b as { type?: string }).type ?? ""),
  );
}

export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic";

  async verify(): Promise<{ provider: string; model: string }> {
    const resolved = await resolveModel();
    return { provider: this.id, model: resolved.id };
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const resolved = await resolveModel();
    const client = anthropicClient();
    const tool: Anthropic.Tool = {
      name: input.toolName,
      description: input.toolDescription,
      input_schema: input.schema as Anthropic.Tool.InputSchema,
    };
    const resp = await client.messages.create({
      model: resolved.id,
      max_tokens: Math.min(MAX_TOKENS, resolved.maxOutputTokens || MAX_TOKENS),
      system: input.system,
      tools: [tool],
      messages: [{ role: "user", content: input.prompt }],
    });
    const call = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === input.toolName,
    );
    return {
      data: call ? call.input : {},
      usage: {
        inputTokens: resp.usage?.input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
      },
      model: resolved.id,
    };
  }

  async run(input: ProviderRunInput): Promise<AgentResult> {
    // The live voice path (effort "low") prefers ANTHROPIC_LIVE_MODEL for speed;
    // the full-report path uses the default (most-capable) model.
    const resolved = await resolveModel({ fast: input.effort === "low" });
    const client = anthropicClient();
    const anthropicTools = toAnthropicTools(input.tools);
    const byName = new Map(input.tools.map((t) => [t.name, t]));

    const trace: Trace = { provider: this.id, model: resolved.id, toolsUsed: [], sources: [], freshness: [] };

    const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let blocks: AiBlock[] = [];
    let navigation: NavIntent | undefined;
    let presentation: PresentationAct[] | undefined;
    let fallbackText = "";
    let inTok = 0;
    let outTok = 0;
    let cacheRead = 0;
    let requests = 0;

    // Reasoning effort (live path passes "low" for speed). Only sent when the
    // resolved model reports effort support — the provider owns model behavior.
    const effortCfg =
      input.effort && resolved.supportsEffort
        ? { output_config: { effort: input.effort } }
        : {};

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Stream the turn (SDK-recommended for large max_tokens — avoids HTTP
      // timeouts on long agentic turns); finalMessage() yields the complete
      // response, so the rest of the loop is unchanged.
      const resp = await client.messages
        .stream({
          model: resolved.id,
          max_tokens: Math.min(MAX_TOKENS, resolved.maxOutputTokens || MAX_TOKENS),
          system: input.system,
          // Only enable adaptive thinking when the resolved model reports support
          // for it — the provider owns model behavior, not the engine.
          ...(resolved.supportsAdaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
          ...effortCfg,
          tools: anthropicTools,
          messages,
        })
        .finalMessage();

      requests++;
      inTok += resp.usage?.input_tokens ?? 0;
      outTok += resp.usage?.output_tokens ?? 0;
      cacheRead += resp.usage?.cache_read_input_tokens ?? 0;

      // Preserve the full assistant turn (thinking + tool_use blocks) verbatim.
      messages.push({ role: "assistant", content: resp.content });

      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      // Capture any plain text as a fallback in case present_report is skipped.
      for (const b of resp.content) {
        if (b.type === "text") fallbackText += b.text;
      }

      const present = toolUses.find((t) => t.name === "present_report");
      if (present) {
        const inp = present.input as {
          blocks?: unknown;
          trace?: Partial<Trace>;
          navigation?: unknown;
          presentation?: unknown;
        };
        blocks = sanitizeBlocks(inp.blocks);
        if (inp.trace) {
          trace.dateRange = inp.trace.dateRange ?? trace.dateRange;
          trace.location = inp.trace.location;
          trace.technician = inp.trace.technician;
          trace.areaManager = inp.trace.areaManager;
          trace.notes = inp.trace.notes;
          if (Array.isArray(inp.trace.sources)) trace.sources = inp.trace.sources;
        }
        // Raw, UNVALIDATED navigation suggestion — the orchestrator sanitizes it
        // against the permission-scoped allowlist before anything is emitted.
        if (inp.navigation && typeof inp.navigation === "object") {
          const n = inp.navigation as Record<string, unknown>;
          if (typeof n.routeId === "string") {
            navigation = {
              routeId: n.routeId,
              params: n.params && typeof n.params === "object" ? (n.params as Record<string, string>) : undefined,
              highlightAnchor: typeof n.highlightAnchor === "string" ? n.highlightAnchor : undefined,
              reason: typeof n.reason === "string" ? n.reason : undefined,
            };
          }
        }
        // Raw, UNVALIDATED guided-tour proposal — same treatment: shape it here,
        // permission-validate EACH stop in the orchestrator. Capped so a runaway
        // plan can't produce an unbounded tour.
        if (Array.isArray(inp.presentation)) {
          const acts: PresentationAct[] = [];
          for (const raw of inp.presentation) {
            if (!raw || typeof raw !== "object") continue;
            const a = raw as Record<string, unknown>;
            if (typeof a.routeId !== "string") continue;
            acts.push({
              routeId: a.routeId,
              params: a.params && typeof a.params === "object" ? (a.params as Record<string, string>) : undefined,
              highlightAnchor: typeof a.highlightAnchor === "string" ? a.highlightAnchor : undefined,
              say: typeof a.say === "string" ? a.say : undefined,
            });
          }
          if (acts.length) presentation = acts.slice(0, 6);
        }
        break;
      }

      if (toolUses.length === 0) {
        // Model answered without calling any tool — stop and use its text.
        break;
      }

      // Execute the requested read tools and feed results back.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const def = byName.get(tu.name);
        const at = new Date().toISOString();
        if (!def) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Tool "${tu.name}" is not available to you.`,
            is_error: true,
          });
          continue;
        }
        try {
          const out = await def.run((tu.input ?? {}) as Record<string, unknown>, input.ctx);
          const t: ToolCallTrace = { name: tu.name, args: tu.input, summary: out.summary, at };
          trace.toolsUsed.push(t);
          if (out.freshness) trace.freshness!.push(...out.freshness);
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(out.data).slice(0, 100_000),
          });
        } catch (e) {
          trace.toolsUsed.push({
            name: tu.name,
            args: tu.input,
            summary: `error: ${e instanceof Error ? e.message : String(e)}`,
            at,
          });
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Tool error: ${e instanceof Error ? e.message : String(e)}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }

    if (blocks.length === 0) {
      blocks = [{ type: "text", text: fallbackText.trim() || "I couldn't produce an answer." }];
    }
    trace.usage = { inputTokens: inTok, outputTokens: outTok, cacheReadTokens: cacheRead, requests };
    // Dedup freshness by source.
    if (trace.freshness && trace.freshness.length) {
      const seen = new Map<string, string>();
      for (const f of trace.freshness) if (!seen.has(f.source)) seen.set(f.source, f.lastSync);
      trace.freshness = [...seen.entries()].map(([source, lastSync]) => ({ source, lastSync }));
    }
    return { blocks, trace, navigation, presentation };
  }
}
