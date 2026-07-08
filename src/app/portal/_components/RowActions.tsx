"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  endpoint: string;
  id: string;
  currentStatus?: "paid" | "unpaid" | null;
  canToggleStatus?: boolean;
  canDelete?: boolean;
}

export default function RowActions({
  endpoint,
  id,
  currentStatus,
  canToggleStatus = true,
  canDelete = true,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggleStatus = async () => {
    if (!currentStatus) return;
    setBusy(true);
    const next = currentStatus === "paid" ? "unpaid" : "paid";
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: id,
          status: next,
          paid_at: next === "paid" ? new Date().toISOString() : null,
        }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirm("Delete this entry permanently?")) return;
    setBusy(true);
    try {
      const res = await fetch(`${endpoint}?_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
      {canToggleStatus && currentStatus && (
        <button
          className="portal-btn"
          onClick={toggleStatus}
          disabled={busy}
          style={{ padding: "4px 10px", fontSize: 11 }}
        >
          {currentStatus === "paid" ? "Mark unpaid" : "Mark paid"}
        </button>
      )}
      {canDelete && (
        <button
          className="portal-btn portal-btn-danger"
          onClick={onDelete}
          disabled={busy}
          style={{ padding: "4px 10px", fontSize: 11 }}
        >
          Delete
        </button>
      )}
    </div>
  );
}
