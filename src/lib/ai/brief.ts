import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { AnthropicProvider } from "./providers/anthropic";
import { runAllDetectors } from "./monitors/run";
import type { ScoredFinding } from "./monitors/framework";
import type { AlertRecord, BriefRecord, BriefSection } from "./monitors/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One punchy sentence summarizing the business this morning." },
    overnight: { type: "array", items: { type: "string" }, description: "What changed since yesterday." },
    attention: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, severity: { type: "string" } } },
      description: "What needs the owner's attention now (highest priority first).",
    },
    decisions: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" } } },
      description: "Decisions to make today.",
    },
    risks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" } } } },
    opportunities: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" } } } },
    doFirst: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" } } },
      description: "Ranked, specific actions — biggest business impact first.",
    },
  },
  required: ["headline", "overnight", "attention", "decisions", "risks", "opportunities", "doFirst"],
};

function asSections(v: unknown): BriefSection[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object" && typeof (x as BriefSection).title === "string") as BriefSection[];
}

/** Run all detectors, persist scored alerts (dedup per day), synthesize the brief. */
export async function generateBrief(): Promise<{ brief: BriefRecord; alerts: AlertRecord[] }> {
  await ensureFinanceIndexes();
  const date = today();
  const now = new Date().toISOString();
  const findings: ScoredFinding[] = await runAllDetectors(); // already priority-ranked

  const alertsCol = coll<AlertRecord>(FINANCE_COLLECTIONS.aiAlert);
  const alerts: AlertRecord[] = [];
  for (const f of findings) {
    const _id = `alrt_${date}_${f.detectorId}_${f.key}`.slice(0, 160);
    await alertsCol.updateOne(
      { _id },
      { $set: { ...f, date }, $setOnInsert: { status: "open", createdAt: now } },
      { upsert: true },
    );
    alerts.push({ ...f, _id, date, status: "open", createdAt: now });
  }

  // One synthesis call → the narrative brief. Findings are pre-scored; the model
  // prioritizes and explains, never invents.
  let headline = findings.length
    ? "Several items need your attention this morning."
    : "All quiet — no issues detected this morning.";
  let parts: Record<string, unknown> = {};
  let usage = { inputTokens: 0, outputTokens: 0 };
  let model: string | undefined;
  try {
    const compact = findings.slice(0, 40).map((f) => ({
      priority: f.priority,
      severity: f.severity,
      category: f.category,
      title: f.title,
      detail: f.detail,
      financialImpact: f.financialImpact,
      recommendedAction: f.recommendedAction,
    }));
    const r = await new AnthropicProvider().synthesize({
      system:
        "You are chief of staff for the AI executive team at LBS Garage Door. Turn the pre-scored findings into a crisp morning brief for a busy owner — specific and decisive, like a management team's daily standup. Order by priority and business impact. Never invent numbers beyond the findings; if there's little to report, say so honestly.",
      prompt: `Today is ${date}. Findings (already scored 0–100 by priority):\n\n${JSON.stringify(compact, null, 2)}\n\nWrite the morning brief.`,
      toolName: "present_brief",
      toolDescription: "Deliver the morning brief in the required sections.",
      schema: BRIEF_SCHEMA,
    });
    parts = (r.data ?? {}) as Record<string, unknown>;
    usage = r.usage;
    model = r.model;
    if (typeof parts.headline === "string" && parts.headline.trim()) headline = parts.headline;
  } catch {
    /* fall back to a deterministic brief from the findings */
  }

  const brief: BriefRecord = {
    _id: `brief_${date}`,
    date,
    generatedAt: now,
    headline,
    overnight: Array.isArray(parts.overnight) ? (parts.overnight as string[]).filter((s) => typeof s === "string") : [],
    attention:
      asSections(parts.attention).length > 0
        ? asSections(parts.attention)
        : findings.filter((f) => f.priority >= 50).slice(0, 6).map((f) => ({ title: f.title, detail: f.detail, severity: f.severity })),
    decisions: asSections(parts.decisions),
    risks: asSections(parts.risks),
    opportunities: asSections(parts.opportunities),
    doFirst:
      asSections(parts.doFirst).length > 0
        ? asSections(parts.doFirst)
        : findings.filter((f) => f.recommendedAction).slice(0, 3).map((f) => ({ title: f.title, detail: f.recommendedAction! })),
    alertCount: alerts.length,
    provider: "anthropic",
    model,
    usage,
  };

  await coll<BriefRecord>(FINANCE_COLLECTIONS.aiBrief).updateOne({ _id: brief._id }, { $set: brief }, { upsert: true });
  return { brief, alerts };
}

export async function getLatestBrief(): Promise<BriefRecord | null> {
  await ensureFinanceIndexes();
  const rows = await coll<BriefRecord>(FINANCE_COLLECTIONS.aiBrief).find({}).sort({ date: -1 }).limit(1).toArray();
  return rows[0] ?? null;
}

export async function getAlerts(opts?: {
  executive?: string;
  status?: "open" | "resolved";
  limit?: number;
}): Promise<AlertRecord[]> {
  await ensureFinanceIndexes();
  const q: Record<string, unknown> = { status: opts?.status ?? "open" };
  if (opts?.executive) q.executives = opts.executive; // array membership
  return coll<AlertRecord>(FINANCE_COLLECTIONS.aiAlert)
    .find(q)
    .sort({ priority: -1, date: -1 })
    .limit(opts?.limit ?? 100)
    .toArray();
}
