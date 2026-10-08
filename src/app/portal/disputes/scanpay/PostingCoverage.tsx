"use client";

/* ═══════════════════════════════════════════════════════════════════════════
   Posting coverage on a Posted row.

   "Posted" is not finished. A dispute charged to the Area Manager may still
   owe a provider charge, so the row shows every target's state and offers
   the ones still open:

       Posted to   ✓ Area Manager · Or · $142.50      — Provider  [Post]

   The coverage handed in is derived server-side from the ledger entries, so
   a charge made from a Provider Ledger page shows as posted here without the
   inbox ever having been involved.

   One trap this component exists to close: posting a provider slice with no
   ledger chosen would fall back to the Area Manager's ledger, putting the
   provider's charge on the AM's balance. So every target except the Area
   Manager's own must name a ledger, and the picker leads with the ledgers
   that plausibly belong to that party.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PostingCoverage, PostingTarget, TargetCoverage } from "@/lib/dispute-targets";

type Ledger = { _id: string; holder_name: string; role: string; location: string };

const money = (n: number) =>
  `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const roleLabel = (r: string) =>
  r === "area_manager" ? "Area Manager" : r === "technician" ? "Technician" : r.replace(/_/g, " ");

/** Role strings are free text and inconsistent in the data: the auto-created
 *  AM ledgers use "area_manager", the ones people create use "Area Manager".
 *  Normalise before comparing, or half the ledgers never match. */
const normRole = (r: string) => r.toLowerCase().replace(/[\s_-]+/g, "");

const ROLE_FOR_TARGET: Record<PostingTarget, string[]> = {
  area_manager: ["areamanager"],
  combined: ["areamanager"],
  technician: ["technician"],
  provider: ["provider", "advertiser"],
};

/** Who this target's ledger most likely belongs to, for pre-selection. */
export interface PartyNames {
  areaManager?: string | null;
  technician?: string | null;
  provider?: string | null;
}

function suggestedHolder(target: PostingTarget, names: PartyNames): string {
  if (target === "provider") return (names.provider ?? "").trim();
  if (target === "technician") return (names.technician ?? "").trim();
  return (names.areaManager ?? "").trim();
}

export default function PostingCoveragePanel({
  coverage, endpoint, names, compact,
}: {
  coverage: PostingCoverage;
  /** The item's action endpoint — the same one Post already uses. */
  endpoint: string;
  names: PartyNames;
  compact?: boolean;
}) {
  const posted = coverage.targets.filter((t) => t.posted);
  const open = coverage.targets.filter((t) => t.available);
  // A target that is neither posted nor available is noise on a row unless it
  // was reversed, which is a thing somebody needs to see.
  const reversed = coverage.targets.filter((t) => t.reversed);
  // Charged under a separate record for the same job and amount — from before
  // one dispute could hold several postings. Shown rather than silently
  // dropped, because "why is Provider not offered" has an answer and the
  // operator needs the record id to check it.
  const elsewhere = coverage.targets.filter((t) => t.chargedElsewhere && !t.posted);

  if (posted.length === 0 && open.length === 0 && reversed.length === 0 && elsewhere.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
        {!compact && (
          <span className="small" style={{ color: "var(--ds-ink-2)", marginRight: 2 }}>Posted to</span>
        )}
        {posted.map((t) => <PostedChip key={t.target} t={t} />)}
        {posted.length === 0 && (
          <span className="small" style={{ color: "var(--ds-ink-2)" }}>nothing yet</span>
        )}
      </div>

      {reversed.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {reversed.map((t) => (
            <span key={t.target} className="small"
              title="This posting was reversed on the ledger, so the party is not charged. It can be posted again."
              style={{ borderRadius: 999, padding: "2px 9px", fontSize: 11.5,
                background: "var(--ds-warn-soft)", color: "var(--ds-warn-text)" }}>
              ↩ {t.label} reversed
            </span>
          ))}
        </div>
      )}

      {elsewhere.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {elsewhere.map((t) => (
            <span key={t.target} className="small" title={t.reason ?? undefined}
              style={{ borderRadius: 999, padding: "2px 9px", fontSize: 11.5,
                background: "var(--ds-warn-soft)", color: "var(--ds-warn-text)" }}>
              ⚠ {t.label} already charged on {t.chargedElsewhere}
            </span>
          ))}
        </div>
      )}

      {open.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {open.map((t) => (
            <PostTargetButton key={t.target} target={t} endpoint={endpoint}
              suggested={suggestedHolder(t.target, names)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostedChip({ t }: { t: TargetCoverage }) {
  const body = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, borderRadius: 999,
      padding: "2px 9px", background: "var(--ds-ok-wash)", color: "var(--ds-ok-text)" }}>
      ✓ {t.label}
      {t.ledgerName ? ` · ${t.ledgerName}` : ""}
      {t.postedAmount != null ? ` · ${money(t.postedAmount)}` : ""}
      {t.ledgerId ? " ↗" : ""}
    </span>
  );
  const title = `${t.label} posted${t.postedAt ? ` on ${t.postedAt.slice(0, 10)}` : ""}${t.ledgerEntryId ? ` · entry ${t.ledgerEntryId}` : ""}`;
  return t.ledgerId
    ? <Link href={`/portal/ledger/${t.ledgerId}`} style={{ textDecoration: "none" }} title={title}>{body}</Link>
    : <span title={title}>{body}</span>;
}

function PostTargetButton({
  target, endpoint, suggested,
}: {
  target: TargetCoverage;
  endpoint: string;
  suggested: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [ledgerId, setLedgerId] = useState("");
  const [loaded, setLoaded] = useState(false);

  // The Area Manager's own ledger is find-or-created by the engine, so it is
  // the one target that can be posted without naming one. Everything else
  // would land on the AM's balance by default, which is simply wrong.
  const mayUseAutomatic = target.target === "area_manager" || target.target === "combined";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/portal/ledger?status=active&pageSize=2000")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const rows: Array<Record<string, unknown>> = Array.isArray(j) ? j : (j.rows ?? []);
        const all = rows
          .map((x) => ({
            _id: String(x._id ?? ""), holder_name: String(x.holder_name ?? ""),
            role: String(x.role ?? ""), location: String(x.location ?? ""),
          }))
          .filter((l) => l._id);
        setLedgers(all);
        setLoaded(true);

        // Pre-select the ledger that belongs to this party: right role, and
        // the holder the job names. Only an exact-ish name match is chosen —
        // guessing the wrong provider's ledger would be worse than asking.
        const wantRoles = ROLE_FOR_TARGET[target.target];
        const byRole = all.filter((l) => wantRoles.includes(normRole(l.role)));
        const needle = suggested.trim().toLowerCase();
        const exact = needle ? byRole.find((l) => l.holder_name.trim().toLowerCase() === needle) : undefined;
        if (exact) setLedgerId(exact._id);
        else if (!mayUseAutomatic && byRole.length === 1) setLedgerId(byRole[0]!._id);
      })
      .catch(() => { if (!cancelled) { setLedgers([]); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [open, target.target, suggested, mayUseAutomatic]);

  async function post() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", party: target.target, ledgerId: ledgerId || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to post");
    } finally { setBusy(false); }
  }

  const wantRoles = ROLE_FOR_TARGET[target.target];
  const matching = ledgers.filter((l) => wantRoles.includes(normRole(l.role)));
  const others = ledgers.filter((l) => !wantRoles.includes(normRole(l.role)));
  const canSubmit = !!ledgerId || mayUseAutomatic;

  return (
    <>
      <button className="portal-btn" style={{ padding: "4px 10px", fontSize: 11 }}
        title={`${target.label}: ${money(target.amount)} — not posted yet`}
        onClick={() => setOpen(true)}>
        Post {target.label} · {money(target.amount)}
      </button>

      {open && (
        <div style={{ position: "fixed", inset: 0, background: "var(--ds-scrim, rgba(0,0,0,0.7))", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 60, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={{ background: "var(--ds-surface-1)", border: "1px solid var(--ds-line)", borderRadius: 14,
            padding: 20, width: "min(520px, 96vw)", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "var(--ds-ink)" }}>Post the {target.label} slice</h3>
              <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="muted small" style={{ marginBottom: 14 }}>
              {money(target.amount)} from the dispute-shares formula. This adds a ledger entry alongside anything
              already posted for this item — it never replaces one.
            </div>

            <label className="portal-label">Ledger</label>
            <select className="portal-input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}
              style={{ marginBottom: 6 }}>
              {mayUseAutomatic
                ? <option value="">Area Manager&apos;s ledger (automatic)</option>
                : <option value="">— choose a ledger —</option>}
              {matching.length > 0 && (
                <optgroup label={`${roleLabel(wantRoles[0] ?? "")} ledgers`}>
                  {matching.map((l) => (
                    <option key={l._id} value={l._id}>
                      {l.holder_name}{l.location ? ` · ${l.location}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Other ledgers">
                  {others.map((l) => (
                    <option key={l._id} value={l._id}>
                      {l.holder_name}{l.role ? ` · ${roleLabel(l.role)}` : ""}{l.location ? ` · ${l.location}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {!mayUseAutomatic && (
              <div className="muted small" style={{ marginBottom: 14 }}>
                A ledger is required here. Without one the charge would default to the Area Manager&apos;s ledger,
                which is not whose slice this is.
                {suggested ? ` This job names ${suggested}.` : ""}
                {loaded && matching.length === 0 ? " No ledger with that role exists yet — create one first, or pick another." : ""}
              </div>
            )}
            {mayUseAutomatic && (
              <div className="muted small" style={{ marginBottom: 14 }}>
                Left automatic, this posts to the job&apos;s Area-Manager ledger, creating it if it does not exist.
              </div>
            )}

            {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="portal-btn portal-btn-primary" onClick={post} disabled={busy || !canSubmit}>
                {busy ? "Posting…" : `Post ${money(target.amount)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
