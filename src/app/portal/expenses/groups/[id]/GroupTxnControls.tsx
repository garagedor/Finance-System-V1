"use client";

// Two small controls for a transaction inside a group:
//  • category editor (free text + suggestions) → PATCH the txn's group_category
//  • remove button → DELETE the txn from the group
// Which one renders depends on the `remove` prop.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CategoryDot } from "../category-color";

const ENDPOINT = "/api/portal/expense-groups/txns";
const LIST_ID = "group-cat-suggestions";

export default function GroupTxnControls({
  txnId,
  category,
  suggestions,
  remove,
}: {
  txnId: string;
  category?: string;
  suggestions?: string[];
  remove?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState(category ?? "");

  if (remove) {
    const onRemove = async () => {
      if (!confirm("Remove this transaction from the group?")) return;
      setBusy(true);
      try {
        const res = await fetch(`${ENDPOINT}?txn_id=${encodeURIComponent(txnId)}`, { method: "DELETE" });
        if (res.ok) router.refresh();
      } finally { setBusy(false); }
    };
    return (
      <button className="portal-btn portal-btn-ghost" onClick={onRemove} disabled={busy}
        style={{ padding: "4px 10px", fontSize: 11 }} title="Remove from group">
        ✕
      </button>
    );
  }

  const save = async (next: string) => {
    const v = next.trim() || "other";
    if (v === (category ?? "")) return;
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txn_id: txnId, category: v }),
      });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <CategoryDot category={value} />
      <input
        list={LIST_ID}
        className="portal-input"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{ padding: "4px 8px", fontSize: 12, width: 140, textTransform: "capitalize" }}
      />
      {suggestions && (
        <datalist id={LIST_ID}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </span>
  );
}
