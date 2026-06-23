// Central audit-log helper. Every mutation that touches money or access
// control should call `audit()` so the change is recorded with before/after
// snapshots, a one-line summary, and the actor's name.
//
// The audit log is append-only by convention — there is no API to delete
// rows. Indexes (target_kind, target_id, changed_at) + (changed_at) +
// (changed_by, changed_at) make queries fast.

import "server-only";
import { coll, FINANCE_COLLECTIONS, newId } from "./finance-db";
import type { AuditKind, AuditRecord } from "@/types/rbac";

interface AuditInput {
  kind: AuditKind;
  target_id: string;
  before: unknown;
  after: unknown;
  summary: string;
  changed_by: string;
  action?: string;
}

/** Append one row to the audit log. Errors are swallowed so audit failures
 *  never break user actions (visibility is at the DB layer). */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const row: AuditRecord = {
      _id: newId("aud"),
      target_kind: input.kind,
      target_id: input.target_id,
      before: scrub(input.before),
      after: scrub(input.after),
      summary: input.summary,
      action: input.action,
      changed_by: input.changed_by,
      changed_at: new Date().toISOString(),
    };
    await coll<AuditRecord>(FINANCE_COLLECTIONS.auditLog).insertOne(row);
  } catch (e) {
    console.error("[audit] failed to write:", e);
  }
}

/** Build a short diff summary "+name; +amount: 100→200; -notes". */
export function diffSummary(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string {
  if (!before) return "created";
  if (!after) return "deleted";
  const parts: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === "_id" || k === "updated_at" || k === "updated_by") continue;
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a === undefined) parts.push(`+${k}`);
    else if (b === undefined) parts.push(`-${k}`);
    else parts.push(`${k}: ${short(a)}→${short(b)}`);
  }
  return parts.slice(0, 6).join("; ") || "no-op";
}

function short(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "string") return v.length > 24 ? v.slice(0, 24) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return Array.isArray(v) ? `[${v.length}]` : "{…}";
}

/** Strip fields the audit log shouldn't store (passwords, encrypted tokens). */
function scrub(o: unknown): unknown {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  const out: Record<string, unknown> = { ...(o as Record<string, unknown>) };
  for (const k of Object.keys(out)) {
    if (
      k === "password" ||
      k === "password_hash" ||
      k === "access_token" ||
      k === "access_token_enc" ||
      k === "refresh_token" ||
      k === "secret"
    ) {
      out[k] = "[redacted]";
    }
  }
  return out;
}
