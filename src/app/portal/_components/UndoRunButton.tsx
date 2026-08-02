"use client";

// Undo the last generation run of a recurring template. Deletes the entries
// that run created (and their linked ledger entries) and rolls the schedule
// back. Only shown when a run is available to undo.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UndoRunButton({
  endpoint,
  templateId,
  count,
}: {
  endpoint: string;      // e.g. /api/portal/recurring-income/undo
  templateId: string;
  count?: number | null; // entries the last run created (for the confirm text)
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    const n = count ?? 0;
    if (!confirm(`Undo the last run? This deletes ${n || "the"} entr${n === 1 ? "y" : "ies"} it created${n ? "" : ""} and any linked ledger entries.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${endpoint}?_id=${encodeURIComponent(templateId)}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setMsg(`Undone ${j.undone}`);
      router.refresh();
      setTimeout(() => setMsg(null), 6000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        className="portal-btn portal-btn-danger"
        onClick={run}
        disabled={busy}
        style={{ padding: "4px 10px", fontSize: 12 }}
        title="Delete the entries the last Run created and roll the schedule back"
      >
        {busy ? "Undoing…" : "↩ Undo run"}
      </button>
      {msg && <span className="small" style={{ color: "#94a3b8" }}>{msg}</span>}
    </span>
  );
}
