// Shared contracts for the AI engine. Deliberately provider-agnostic: nothing
// here references Anthropic. Swapping providers means implementing AiProvider,
// not touching these types, the tools, or the engine.

export type Tone = "pos" | "neg" | "neutral";
export type Severity = "high" | "medium" | "low" | "info";
export type Priority = "high" | "medium" | "low";

/** A renderable unit of an executive answer. Responses are NOT chat-only —
 *  they are a sequence of these blocks (text + cards + charts + tables …). */
export type AiBlock =
  | { type: "text"; text: string }
  | { type: "kpis"; items: { label: string; value: string; delta?: string; tone?: Tone }[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | {
      type: "chart";
      chartType: "line" | "bar";
      title?: string;
      xKey: string;
      series: { key: string; label: string }[];
      data: Record<string, unknown>[];
    }
  | { type: "recommendations"; items: { title: string; detail: string; priority?: Priority }[] }
  | { type: "alerts"; items: { severity: Severity; title: string; detail: string }[] };

/** One tool invocation, recorded for the traceability panel. */
export type ToolCallTrace = { name: string; args: unknown; summary: string; at: string };

/** How an answer was produced — surfaced to the user so nothing is a black box. */
export type Trace = {
  provider?: string;
  model?: string;
  dateRange?: string;
  location?: string;
  technician?: string;
  areaManager?: string;
  sources?: string[];
  toolsUsed: ToolCallTrace[];
  freshness?: { source: string; lastSync: string }[];
  notes?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; requests: number };
};

/** A navigation the model PROPOSES alongside its answer (live mode only). It is
 *  only a suggestion — the orchestrator validates routeId/params/anchor against
 *  the permission-scoped capability allowlist before any step is emitted. */
export type NavIntent = {
  routeId: string;
  params?: Record<string, string>;
  highlightAnchor?: string;
  reason?: string;
};

/** One stop in a guided Presentation: a place to take the owner (validated
 *  against the permission-scoped allowlist exactly like NavIntent) plus an
 *  optional spoken line for that stop. A Presentation is an ORDERED sequence of
 *  these — it turns a one-hop answer into a guided tour of the real pages while
 *  the assistant narrates. Every stop is still server-validated + client-rechecked
 *  and read-only; the sequence only lets the model choreograph several hops. */
export type PresentationAct = {
  routeId: string;
  params?: Record<string, string>;
  highlightAnchor?: string;
  say?: string;
};

export type AgentResult = {
  blocks: AiBlock[];
  trace: Trace;
  navigation?: NavIntent;
  presentation?: PresentationAct[];
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** The caller's identity, used to permission-check every tool. */
export type ToolContext = {
  session: { userId?: string; name: string; type: string; permissions: string[] };
};

/** A read-only capability the engine can call. Wraps EXISTING business logic;
 *  never raw DB access from the model. */
export type ToolDef = {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
  /** Permission required to use it (admins bypass). */
  permission?: string;
  /** Execute and return data + a one-line summary + optional freshness meta. */
  run: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<{ data: unknown; summary: string; freshness?: { source: string; lastSync: string }[] }>;
};

export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type ProviderRunInput = {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  ctx: ToolContext;
  /** Reasoning effort. Lower = faster, fewer/consolidated tool calls (used for
   *  the live voice path). Omitted = the model's default (high). */
  effort?: AiEffort;
};

/** One-shot structured completion — the model fills a single schema-shaped
 *  object. Used by the proactive brief so synthesis stays in the provider. */
export type SynthesisInput = {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
};
export type SynthesisResult = {
  data: unknown;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

/** The provider abstraction. Anthropic is the first implementation; OpenAI /
 *  Gemini / others can be added without changing the engine or the tools. */
export interface AiProvider {
  readonly id: string;
  /** Confirm the provider is usable (key present, configured model exists).
   *  Throws with a clear, user-facing message on failure. */
  verify(): Promise<{ provider: string; model: string }>;
  /** Run the agent loop and return structured blocks + a trace. */
  run(input: ProviderRunInput): Promise<AgentResult>;
  /** One-shot structured completion (single schema-shaped object). */
  synthesize(input: SynthesisInput): Promise<SynthesisResult>;
}
