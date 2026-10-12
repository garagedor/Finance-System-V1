"use client";

// Move a posted dispute/refund charge to another Area Manager's ledger.
// Same amount; the server refuses anything that would double-charge.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Ledger = { _id: string; holder_name: string; role: string; location: string };
const isAm = (r: string) => r.toLowerCase().replace(/[\s_-]+/g, "") === "areamanager";

export default function TransferEntryButton({ ledgerId, entryId }: { ledgerId: string; entryId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ledgers, setLedgers] = useState<Ledger[] | null>(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setErr(null);
    if (ledgers) return;
    try {
      const j = await fetch("/api/portal/ledger?status=active&pageSize=2000").then((r) => r.json());
      const rows: Array<Record<string, unknown>> = Array.isArray(j) ? j : (j.rows ?? []);
      setLedgers(
        rows
          .map((r) => ({ _id: String(r._id ?? ""), holder_name: String(r.holder_name ?? ""), role: String(r.role ?? ""), location: String(r.location ?? "") }))
          .filter((l) => l._id && l._id !== ledgerId && isAm(l.role))
          .sort((a, b) => a.holder_name.localeCompare(b.holder_name)),
      );
    } catch {
      setErr("Couldn't load ledgers");
    }
  }

  async function doTransfer() {
    if (!to) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portal/ledger/${ledgerId}/entries/${entryId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toLedgerId: to }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="portal-btn portal-btn-ghost"
        style={{ padding: "4px 10px", fontSize: 11 }}
        onClick={start}
        title="Move this charge to another Area Manager's ledger (same amount)"
      >
        ⇄ Transfer
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", flexWrap: "wrap", justifyContent: "flex-end" }}>
      <select className="portal-input" style={{ padding: "3px 6px", fontSize: 11, maxWidth: 200 }} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy || !ledgers}>
        <option value="">{ledgers ? "Move to Area Manager…" : "Loading…"}</option>
        {ledgers?.map((l) => (
          <option key={l._id} value={l._id}>{l.holder_name}{l.location ? ` · ${l.location}` : ""}</option>
        ))}
      </select>
      <button className="portal-btn portal-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={doTransfer} disabled={busy || !to}>
        {busy ? "…" : "Confirm transfer"}
      </button>
      <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => { setOpen(false); setErr(null); }} disabled={busy}>
        Cancel
      </button>
      {err && <span className="money-neg small">{err}</span>}
    </span>
  );
}
