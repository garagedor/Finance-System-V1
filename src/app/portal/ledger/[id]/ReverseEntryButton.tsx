"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReverseEntryButton({
  ledgerId,
  entryId,
}: {
  ledgerId: string;
  entryId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doReverse() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portal/ledger/${ledgerId}/entries/${entryId}/reverse`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
        <button
          className="portal-btn portal-btn-primary"
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={doReverse}
          disabled={busy}
        >
          {busy ? "…" : "Confirm reverse"}
        </button>
        <button
          className="portal-btn portal-btn-ghost"
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => { setConfirming(false); setErr(null); }}
          disabled={busy}
        >
          Cancel
        </button>
        {err && <span className="money-neg small">{err}</span>}
      </span>
    );
  }

  return (
    <button
      className="portal-btn portal-btn-ghost"
      style={{ padding: "4px 10px", fontSize: 11 }}
      onClick={() => setConfirming(true)}
      title="Post a reversing entry that cancels this one"
    >
      ↩ Reverse
    </button>
  );
}
