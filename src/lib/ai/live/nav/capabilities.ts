// Page Capability Registry — the safety allowlist for JARVIS navigation.
//
// Isomorphic (no `server-only`): the orchestrator validates against it on the
// server, and the client re-validates before router.push (defense in depth).
// Everything keys off an allowlisted routeId; the model can never navigate to a
// raw path it invents. Permissions come from the existing FINANCE_NAV registry.

import { findActiveModule, visibleNavFor, type FinanceModule } from "@/app/portal/nav";

export type NavSession = { permissions: ReadonlyArray<string>; type?: string };

type Capability = { allowedParams: string[]; anchors?: string[] };

// Deep-linkable portal routes (routeId === href). Param names are the exact
// URL search params each page reads. All are READ-ONLY view pages — no action
// params (e.g. `new`) are ever allowed.
export const NAV_CAPABILITIES: Record<string, Capability> = {
  "/portal/dashboard": {
    allowedParams: ["preset", "from", "to"],
    anchors: ["ai-revenue", "ai-gross-profit", "ai-net-profit", "ai-expenses", "ai-cash", "ai-payables", "ai-receivables"],
  },
  "/portal/income": {
    allowedParams: ["from", "to", "source"],
    anchors: ["ai-inc-total", "ai-inc-crm", "ai-inc-manual"],
  },
  "/portal/expenses": {
    allowedParams: ["from", "to", "category", "status", "vendor"],
    anchors: ["ai-exp-total", "ai-exp-paid", "ai-exp-unpaid"],
  },
  "/portal/payouts": { allowedParams: ["status", "recipient", "tab"] },
  "/portal/reports": { allowedParams: ["type", "subject"], anchors: ["ai-rep-total"] },
  "/portal/debts": { allowedParams: ["status", "party"] },
  "/portal/disputes": { allowedParams: ["from", "to", "status", "tab"] },
  "/portal/equipment": { allowedParams: ["from", "to", "type"] },
  "/portal/banking": { allowedParams: [] },
  "/portal/banking/synced": { allowedParams: ["from", "to", "direction", "recon", "q"] },
  "/portal/banking/settlements": { allowedParams: ["from", "to", "party"] },
  "/portal/banking/reconcile": {
    allowedParams: ["from", "to"],
    anchors: ["ai-recon-unmatched", "ai-recon-unmatched-sum", "ai-recon-rate"],
  },
  "/portal/providers": { allowedParams: [] },
  "/portal/area-managers": { allowedParams: [] },
  "/portal/technicians": { allowedParams: [] },
  "/portal/employees": { allowedParams: [] },
  "/portal/ledger": { allowedParams: [] },
  "/portal/documents": { allowedParams: [] },
  "/portal/admin/users": { allowedParams: ["q", "role", "status"] },
  "/portal/admin/audit": { allowedParams: ["kind", "by", "q"] },
  "/portal/settings": { allowedParams: [] },
};

// Navigate-only legacy CRM targets: those report pages hold filters in React
// state (not the URL), so JARVIS can take you there but not auto-filter them.
// They gate on user.type in the app, so we mirror that with a privileged-type check.
export type CrmTarget = { routeId: string; label: string };
export const CRM_TARGETS: CrmTarget[] = [
  { routeId: "/balance-report", label: "Balance Report" },
  { routeId: "/stats", label: "Statistics" },
  { routeId: "/report", label: "Penalty / Dispute Report" },
  { routeId: "/tables", label: "Data Tables" },
];
const CRM_ALLOWED_TYPES = new Set(["admin", "location-manager"]);

export type ResolvedCapability = {
  module: FinanceModule | null;
  cap: Capability;
  isCrm: boolean;
  label: string;
};

/** Resolve a routeId to its capability + owning module, or null if not allowlisted. */
export function resolveCapability(routeId: string): ResolvedCapability | null {
  const cap = NAV_CAPABILITIES[routeId];
  if (cap) {
    const module = findActiveModule(routeId);
    return { module, cap, isCrm: false, label: module?.label ?? routeId };
  }
  const crm = CRM_TARGETS.find((t) => t.routeId === routeId);
  if (crm) return { module: null, cap: { allowedParams: [] }, isCrm: true, label: crm.label };
  return null;
}

/** True only if the route is allowlisted AND this session may open it. */
export function canNavigate(routeId: string, session: NavSession): boolean {
  const r = resolveCapability(routeId);
  if (!r) return false;
  if (session.type === "admin") return true;
  if (r.isCrm) return !!session.type && CRM_ALLOWED_TYPES.has(session.type);
  const mod = r.module;
  return !!mod && visibleNavFor(session.permissions).some((m) => m.href === mod.href);
}

export type SanitizedNav = { routeId: string; params: Record<string, string>; anchor?: string };

/** Validate a model-proposed navigation: reject unknown/forbidden routes, drop
 *  params not in the allowlist, keep an anchor only if the route declares it. */
export function sanitizeNav(
  input: { routeId?: unknown; params?: unknown; highlightAnchor?: unknown },
  session: NavSession,
): SanitizedNav | null {
  const routeId = typeof input.routeId === "string" ? input.routeId : "";
  if (!routeId || !canNavigate(routeId, session)) return null;
  const r = resolveCapability(routeId)!;
  const allowed = new Set(r.cap.allowedParams);
  const params: Record<string, string> = {};
  if (input.params && typeof input.params === "object") {
    for (const [k, v] of Object.entries(input.params as Record<string, unknown>)) {
      if (!allowed.has(k) || v == null) continue;
      const s = String(v).slice(0, 120);
      if (s) params[k] = s;
    }
  }
  let anchor: string | undefined;
  if (typeof input.highlightAnchor === "string" && r.cap.anchors?.includes(input.highlightAnchor)) {
    anchor = input.highlightAnchor;
  }
  return { routeId, params, anchor };
}

/** Build the href (with query string) for client navigation. */
export function hrefFor(routeId: string, params?: Record<string, string>): string {
  if (!params || Object.keys(params).length === 0) return routeId;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${routeId}?${qs}` : routeId;
}

/** The routes this session can be navigated to — used to build the model prompt. */
export function navigableRoutesFor(
  session: NavSession,
): { routeId: string; label: string; params: string[]; anchors: string[] }[] {
  const out: { routeId: string; label: string; params: string[]; anchors: string[] }[] = [];
  for (const routeId of Object.keys(NAV_CAPABILITIES)) {
    if (!canNavigate(routeId, session)) continue;
    const r = resolveCapability(routeId)!;
    out.push({ routeId, label: r.label, params: r.cap.allowedParams, anchors: r.cap.anchors ?? [] });
  }
  for (const t of CRM_TARGETS) {
    if (!canNavigate(t.routeId, session)) continue;
    out.push({ routeId: t.routeId, label: t.label, params: [], anchors: [] });
  }
  return out;
}
