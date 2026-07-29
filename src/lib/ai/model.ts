import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Provider-layer model resolution for Anthropic.
//
// There is NO hardcoded model identifier anywhere in this file. The model is
// either (a) taken from ANTHROPIC_MODEL and validated against the live Models
// API, or (b) auto-selected from the Models API using an explicit,
// metadata-based selection policy (see scoreModel). Everything outside the
// provider layer stays unaware of Anthropic model names.

export type ValidationStatus =
  | "ok"
  | "invalid_model"
  | "auth_error"
  | "connection_error"
  | "no_key"
  | "unvalidated";

export type ConnectionStatus = "ok" | "error" | "no_key";

export type ModelStatus = {
  provider: "anthropic";
  configuredModel: string | null; // ANTHROPIC_MODEL, or null when auto-selecting
  resolvedModel: string | null; // the model actually in use
  selection: "configured" | "auto" | "none";
  validationStatus: ValidationStatus;
  connectionStatus: ConnectionStatus;
  lastValidatedAt: string | null;
  detail?: string;
  availableModels?: string[]; // offered only when a configured model is invalid
};

/** What the provider needs to drive a request — id + behavior flags derived
 *  from the model's own capability metadata (never from its name). */
export type ResolvedModel = {
  id: string;
  supportsAdaptiveThinking: boolean;
  maxOutputTokens: number;
};

export class AiConfigError extends Error {
  status: ValidationStatus;
  constructor(status: ValidationStatus, message: string) {
    super(message);
    this.status = status;
    this.name = "AiConfigError";
  }
}

const CACHE_TTL_MS = 10 * 60_000;

function envModel(): string | null {
  const v = process.env.ANTHROPIC_MODEL?.trim();
  return v ? v : null;
}

export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

let _client: Anthropic | null = null;
export function anthropicClient(): Anthropic {
  if (!hasAnthropicKey()) {
    throw new AiConfigError("no_key", "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server.");
  }
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// The Models API objects are loosely typed across SDK versions; read defensively.
type ApiModel = {
  id: string;
  created_at?: string;
  max_input_tokens?: number;
  max_tokens?: number;
  capabilities?: Record<string, unknown>;
};

function capSupported(caps: Record<string, unknown> | undefined, path: string[]): boolean {
  let cur: unknown = caps;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return !!(cur && typeof cur === "object" && (cur as { supported?: unknown }).supported);
}

function toResolved(m: ApiModel): ResolvedModel {
  return {
    id: m.id,
    supportsAdaptiveThinking: capSupported(m.capabilities, ["thinking", "types", "adaptive"]),
    maxOutputTokens: typeof m.max_tokens === "number" && m.max_tokens > 0 ? m.max_tokens : 8192,
  };
}

// ── Explicit selection policy ────────────────────────────────────────────────
// Rank purely on OBJECTIVE capability metadata reported by the Models API, plus
// recency as a tiebreak. No model-name or family-name matching. Higher score =
// more capable for our agentic, tool-using, structured-output workload.
function scoreModel(m: ApiModel): number {
  const ctx = typeof m.max_input_tokens === "number" ? m.max_input_tokens : 0;
  const out = typeof m.max_tokens === "number" ? m.max_tokens : 0;
  let s = 0;
  s += Math.log10(Math.max(ctx, 1)) * 10; // larger context window
  s += Math.log10(Math.max(out, 1)) * 4; // larger output ceiling
  if (capSupported(m.capabilities, ["thinking", "types", "adaptive"])) s += 40; // needed by the engine
  if (capSupported(m.capabilities, ["structured_outputs"])) s += 15;
  if (capSupported(m.capabilities, ["effort", "max"])) s += 12;
  if (capSupported(m.capabilities, ["effort", "xhigh"])) s += 6;
  if (capSupported(m.capabilities, ["image_input"])) s += 4;
  return s;
}

function selectBest(models: ApiModel[]): ApiModel | null {
  if (!models.length) return null;
  return [...models].sort((a, b) => {
    const d = scoreModel(b) - scoreModel(a);
    if (Math.abs(d) > 1e-9) return d;
    const ta = Date.parse(a.created_at ?? "") || 0;
    const tb = Date.parse(b.created_at ?? "") || 0;
    return tb - ta; // newest wins ties
  })[0];
}

async function listModels(): Promise<ApiModel[]> {
  const out: ApiModel[] = [];
  for await (const m of anthropicClient().models.list()) out.push(m as unknown as ApiModel);
  return out;
}

// ── Resolution (cached) ──────────────────────────────────────────────────────
let _cache: { resolved: ResolvedModel; status: ModelStatus; at: number } | null = null;

async function resolveFresh(): Promise<{ resolved: ResolvedModel; status: ModelStatus }> {
  const now = new Date().toISOString();
  const configured = envModel();
  const client = anthropicClient();

  if (configured) {
    try {
      const m = (await client.models.retrieve(configured)) as unknown as ApiModel;
      const resolved = toResolved(m);
      return {
        resolved,
        status: {
          provider: "anthropic",
          configuredModel: configured,
          resolvedModel: resolved.id,
          selection: "configured",
          validationStatus: "ok",
          connectionStatus: "ok",
          lastValidatedAt: now,
          detail: `Configured model "${resolved.id}" validated against the Models API.`,
        },
      };
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 404) {
        throw new AiConfigError(
          "invalid_model",
          `Configured model "${configured}" was not found on Anthropic's Models API. ` +
            `Set ANTHROPIC_MODEL to a valid id, or unset it to let the engine auto-select.`,
        );
      }
      if (err?.status === 401) {
        throw new AiConfigError("auth_error", "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.");
      }
      throw new AiConfigError("connection_error", `Could not reach Anthropic: ${err?.message ?? String(e)}`);
    }
  }

  // Auto-select from the live catalog.
  let models: ApiModel[];
  try {
    models = await listModels();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 401) throw new AiConfigError("auth_error", "Anthropic rejected the API key (401).");
    throw new AiConfigError("connection_error", `Could not reach the Anthropic Models API: ${err?.message ?? String(e)}`);
  }
  const best = selectBest(models);
  if (!best) throw new AiConfigError("connection_error", "The Anthropic Models API returned no models.");
  const resolved = toResolved(best);
  // Log which model was selected (server log only — never the key).
  console.info(
    `[ai] Auto-selected model "${resolved.id}" from ${models.length} available (policy: capability metadata + recency).`,
  );
  return {
    resolved,
    status: {
      provider: "anthropic",
      configuredModel: null,
      resolvedModel: resolved.id,
      selection: "auto",
      validationStatus: "ok",
      connectionStatus: "ok",
      lastValidatedAt: now,
      detail: `Auto-selected "${resolved.id}" from ${models.length} available models by capability + recency.`,
    },
  };
}

/** Resolve the model to use (cached). Throws AiConfigError on misconfiguration. */
export async function resolveModel(): Promise<ResolvedModel> {
  if (!hasAnthropicKey()) throw new AiConfigError("no_key", "ANTHROPIC_API_KEY is not set.");
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.resolved;
  const r = await resolveFresh();
  _cache = { ...r, at: Date.now() };
  return r.resolved;
}

/** Full status for the health/config screen. Never throws; never exposes the key. */
export async function getModelStatus(): Promise<ModelStatus> {
  const configured = envModel();
  if (!hasAnthropicKey()) {
    return {
      provider: "anthropic",
      configuredModel: configured,
      resolvedModel: null,
      selection: "none",
      validationStatus: "no_key",
      connectionStatus: "no_key",
      lastValidatedAt: null,
      detail: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server.",
    };
  }
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.status;
  try {
    const r = await resolveFresh();
    _cache = { ...r, at: Date.now() };
    return r.status;
  } catch (e: unknown) {
    const status: ValidationStatus = e instanceof AiConfigError ? e.status : "connection_error";
    const reachedApi = status === "invalid_model" || status === "auth_error";
    let availableModels: string[] | undefined;
    if (status === "invalid_model") {
      try {
        availableModels = (await listModels()).map((m) => m.id).slice(0, 25);
      } catch {
        /* ignore — the primary error is what matters */
      }
    }
    return {
      provider: "anthropic",
      configuredModel: configured,
      resolvedModel: null,
      selection: configured ? "configured" : "auto",
      validationStatus: status,
      connectionStatus: reachedApi ? "ok" : "error",
      lastValidatedAt: null,
      detail: e instanceof Error ? e.message : String(e),
      availableModels,
    };
  }
}
