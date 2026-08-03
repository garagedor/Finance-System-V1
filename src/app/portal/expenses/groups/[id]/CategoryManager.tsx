"use client";

// Editable breakdown-by-category table. Rename a category (updates every
// transaction in the group that uses it) and change its color — centrally,
// from the top, instead of per transaction.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt$ } from "../../../format";

export type CatRow = { name: string; color: string; count: number; spent: number };

export default function CategoryManager({
  groupId,
  categories,
  totalSpent,
}: {
  groupId: string;
  categories: CatRow[];
  totalSpent: number;
}) {
  return (
    <table className="portal-table">
      <thead>
        <tr><th>Category</th><th className="right">Txns</th><th className="right">Spent</th><th className="right">% of spend</th></tr>
      </thead>
      <tbody>
        {categories.map((c) => (
          <Row key={c.name} groupId={groupId} row={c} totalSpent={totalSpent} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ groupId, row, totalSpent }: { groupId: string; row: CatRow; totalSpent: number }) {
  const router = useRouter();
  const [name, setName] = useState(row.name);
  const [color, setColor] = useState(row.color);
  const [busy, setBusy] = useState(false);

  const patch = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/portal/expense-groups/category", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId, from: row.name, ...payload }),
      });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  };

  const saveName = () => {
    const v = name.trim();
    if (!v || v === row.name) { setName(row.name); return; }
    patch({ to: v });
  };
  const saveColor = (hex: string) => { setColor(hex); patch({ color: hex }); };

  return (
    <tr>
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input
            type="color"
            value={color}
            disabled={busy}
            onChange={(e) => saveColor(e.target.value)}
            title="Change color"
            style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
          />
          <input
            className="portal-input"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ padding: "4px 8px", fontSize: 12, width: 160, textTransform: "capitalize" }}
          />
        </span>
      </td>
      <td className="right small">{row.count}</td>
      <td className="right money money-neg">{fmt$(row.spent)}</td>
      <td className="right muted small">{totalSpent > 0 ? `${((row.spent / totalSpent) * 100).toFixed(1)}%` : "—"}</td>
    </tr>
  );
}
