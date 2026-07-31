import "server-only";
import type { AiBlock, Priority, Severity } from "@/lib/ai/types";
import type { AlertRecord, BriefRecord } from "@/lib/ai/monitors/types";
import { sanitizeNav, type NavSession } from "./nav/capabilities";
import type { PlanStep, PresentationPlan } from "./plan-schema";

// Turn the already-computed Morning Brief (cron-precomputed daily; see
// lib/ai/brief.ts) into a Presentation Plan — a spoken walkthrough that DRIVES
// the owner to the exact pages + figures the brief is discussing. No model call:
// the brief prose is already synthesized, so this is instant ("the thinking was
// already done"). Reuses the Presentation Engine: the same PlanStep the live
// orchestrator emits, and the same permission-scoped sanitizeNav on every stop.

// Where each finance detector's evidence lives, so a flagged item can take the
// owner straight to the page + highlighted figure. Only allowlisted routes /
// anchors appear here; every stop is STILL run through sanitizeNav below, so a
// user is never driven to a page they can't see (read-only, view + highlight only).
const TARGET_BY_DETECTOR: Record<string, { routeId: string; anchor?: string }> = {
  "finance.negative_cash": { routeId: "/portal/dashboard", anchor: "ai-cash" },
  "finance.cashflow_decline": { routeId: "/portal/dashboard", anchor: "ai-net-profit" },
  "finance.expense_spike": { routeId: "/portal/expenses", anchor: "ai-exp-total" },
  "finance.duplicate_payments": { routeId: "/portal/expenses", anchor: "ai-exp-total" },
  "finance.unusual_outflow": { routeId: "/portal/banking/synced" },
  "finance.unmatched_txns": { routeId: "/portal/banking/reconcile", anchor: "ai-recon-unmatched" },
  "finance.open_disputes": { routeId: "/portal/disputes" },
  "finance.ledger_outliers": { routeId: "/portal/ledger" },
};
const TARGET_BY_CATEGORY: Record<string, { routeId: string; anchor?: string }> = {
  finance: { routeId: "/portal/dashboard" },
};

const MAX_TOUR_STOPS = 3;
const MAX_OVERNIGHT_SPOKEN = 3;

const toSev = (s?: string): Severity =>
  s === "high" || s === "medium" || s === "low" || s === "info" ? s : "info";

/** On-screen evidence for the brief (rendered in the orb by AiBlocksLite). */
function briefBlocks(brief: BriefRecord): AiBlock[] {
  const blocks: AiBlock[] = [{ type: "text", text: brief.headline }];
  if (brief.overnight.length) {
    blocks.push({
      type: "text",
      text: `What changed overnight:\n${brief.overnight.map((o) => `• ${o}`).join("\n")}`,
    });
  }
  const attn = brief.attention.slice(0, 6);
  if (attn.length) {
    blocks.push({
      type: "alerts",
      items: attn.map((a) => ({ severity: toSev(a.severity), title: a.title, detail: a.detail })),
    });
  }
  const df = brief.doFirst.slice(0, 4);
  if (df.length) {
    blocks.push({
      type: "recommendations",
      items: df.map((d, i) => ({
        title: d.title,
        detail: d.detail,
        priority: (i === 0 ? "high" : i === 1 ? "medium" : "low") as Priority,
      })),
    });
  }
  return blocks;
}

/** Build the spoken + screen-driving Morning Brief presentation. */
export function buildBriefPlan(
  brief: BriefRecord,
  alerts: AlertRecord[],
  session: NavSession,
): PresentationPlan {
  const steps: PlanStep[] = [];

  // Evidence up front so the summary is always available in the orb panel.
  steps.push({ type: "show_evidence", blocks: briefBlocks(brief) });

  // Greeting + headline, then what changed overnight (the heart of the brief).
  steps.push({ type: "speak", text: `Good morning. ${brief.headline}`, subtitle: brief.headline });
  for (const line of brief.overnight.slice(0, MAX_OVERNIGHT_SPOKEN)) {
    steps.push({ type: "speak", text: line, subtitle: line });
  }

  // Guided tour of the top flagged items — drive to the page + figure, one stop
  // per page, every stop permission-validated. Alerts arrive priority-ranked.
  const visited = new Set<string>();
  let stops = 0;
  for (const a of alerts) {
    if (stops >= MAX_TOUR_STOPS) break;
    const target = TARGET_BY_DETECTOR[a.detectorId] ?? TARGET_BY_CATEGORY[a.category];
    if (!target) continue;
    const nav = sanitizeNav({ routeId: target.routeId, highlightAnchor: target.anchor }, session);
    if (!nav || visited.has(nav.routeId)) continue;
    visited.add(nav.routeId);
    const line = a.metric ? `${a.title} — ${a.metric}.` : `${a.title}.`;
    steps.push({ type: "speak", text: line, subtitle: line });
    steps.push({ type: "navigate", routeId: nav.routeId, params: nav.params, reason: line });
    steps.push({ type: "pause", ms: 500 });
    if (nav.anchor) steps.push({ type: "highlight", routeId: nav.routeId, anchorId: nav.anchor });
    stops++;
  }

  // Close on the single most important next action.
  const first = brief.doFirst[0];
  if (first) {
    steps.push({ type: "speak", text: `First thing I'd tackle: ${first.title}.`, subtitle: first.title });
  }

  return { intent: "morning_brief", leadPersona: "cfo", steps };
}
