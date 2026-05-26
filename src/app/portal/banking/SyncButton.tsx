"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton({ itemId, label }: { itemId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const url = itemId
        ? `/api/portal/plaid/sync?item_id=${encodeURIComponent(itemId)}`
        : "/api/portal/plaid/sync";
      const res = await fetch(url, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Sync failed");
      const total = (j.results ?? []).reduce(
        (acc: { added: number; modified: number; removed: number }, r: { added: number; modified: number; removed: number }) => ({
          added: acc.added + r.added,
          modified: acc.modified + r.modified,
          removed: acc.removed + r.removed,
        }),
        { added: 0, modified: 0, removed: 0 }
      );
      setMsg(`+${total.added} · ~${total.modified} · −${total.removed}`);
      router.refresh();
      setTimeout(() => setMsg(null), 5000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        className="portal-btn"
        onClick={sync}
        disabled={busy}
        style={itemId ? { padding: "4px 10px", fontSize: 12 } : undefined}
      >
        {busy ? "Syncing…" : label ?? "↻ Sync now"}
      </button>
      {msg && <span style={{ fontSize: 11, color: "#94a3b8" }}>{msg}</span>}
    </div>
  );
}
