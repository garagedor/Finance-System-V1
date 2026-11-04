// Pure helpers for ScanPay WRITE actions (no I/O — unit-tested).

import { techMatches } from "./match-score";

export interface ScanpayMember {
  memberId: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  role?: string;   // owner | admin | member | custom
  status?: string; // ACTIVE | INACTIVE | INVITED
}

export const memberName = (m: ScanpayMember) => [m.firstName, m.lastName].filter(Boolean).join(" ").trim();

/**
 * Who creates the invoice in ScanPay (owner default, 2026-11-05): the job's
 * tech when they can be matched to an active member — so they can collect in
 * their own app — otherwise the account owner (then an admin).
 */
export function pickMember(members: ScanpayMember[], tech: string | null | undefined): { member: ScanpayMember; why: "tech" | "owner" | "admin" } | null {
  const active = members.filter((m) => !m.status || m.status === "ACTIVE");
  if (tech) {
    const hits = active.filter((m) => techMatches(tech, [memberName(m)]));
    if (hits.length === 1) return { member: hits[0], why: "tech" };
  }
  const owner = active.find((m) => m.role === "owner");
  if (owner) return { member: owner, why: "owner" };
  const admin = active.find((m) => m.role === "admin");
  return admin ? { member: admin, why: "admin" } : null;
}

/** The ScanPay account a location uses: the one most of its paid invoices went through. */
export function majorityTeam(counts: Map<number, number>): number | null {
  let best: number | null = null;
  let n = 0;
  for (const [team, c] of counts) if (c > n) { best = team; n = c; }
  return best;
}

/** "3110 Crosby St, Rockford, IL 61107" → parts ScanPay's address form needs (null if unsure). */
export function parseUsAddress(raw: string | null | undefined): { street: string; city: string; state: string; zipCode: string } | null {
  const parts = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const tail = parts[parts.length - 1];
  const m = /^([A-Za-z]{2}|[A-Za-z][A-Za-z ]+?)\s+(\d{5})(?:-\d{4})?$/.exec(tail);
  let state: string, zipCode: string, cityIdx: number;
  if (m) { state = m[1]; zipCode = m[2]; cityIdx = parts.length - 2; }
  else if (/^\d{5}$/.test(tail) && parts.length >= 4) { zipCode = tail; state = parts[parts.length - 2]; cityIdx = parts.length - 3; }
  else return null;
  const street = parts.slice(0, cityIdx).join(", ");
  const city = parts[cityIdx];
  return street && city ? { street, city, state, zipCode } : null;
}

/** Split a client name into ScanPay's first/last (both required). */
export function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const p = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return { firstName: "Customer", lastName: "-" };
  return { firstName: p[0], lastName: p.slice(1).join(" ") || "-" };
}

/** A payment that went through. Failed / declined / voided attempts can't be refunded. */
export function isRefundableStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "").toUpperCase();
  return /SUCCE|PAID|SETTLED|COMPLETE|CAPTURED|PARTIALLY.?REFUNDED/.test(s) && !/FAIL|DECLIN|VOID|CANCEL/.test(s);
}

/** What can still be refunded on a payment. */
export function refundable(paid: number, alreadyRefunded: number): number {
  return Math.max(0, Math.round((paid - alreadyRefunded) * 100) / 100);
}

export const MARK_PAID_METHODS = ["m-cash", "m-check", "m-direct-transfer", "m-other"] as const;
export type MarkPaidMethod = (typeof MARK_PAID_METHODS)[number];
