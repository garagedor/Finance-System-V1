"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Permanently delete a single ledger line. For linked/system entries we warn
// that the source record isn't updated (and may re-post its entry later).
export default function DeleteEntryButton({
  ledgerId,
  entryId,
  linkedLabel,
}: {
  ledgerId: string;
  entryId: string;
  linkedLabel?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    const base = "Permanently delete this ledger line? This changes the balance and can't be undone.";
    const warn = linkedLabel
      ? `\n\n⚠ This line came from ${linkedLabel}. Deleting it here does NOT update that record` +
        (linkedLabel.includes("payout") || linkedLabel.includes("equipment") ? ", and it may be re-posted automatically on the next sync." : ".")
      : "";
    if (!confirm(base + warn)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/ledger/${ledgerId}/entries?entryId=${encodeURIComponent(entryId)}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else { const j = await res.json().catch(() => ({})); alert(j.error || "Failed to delete"); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="portal-btn portal-btn-danger"
      onClick={onDelete}
      disabled={busy}
      style={{ padding: "4px 10px", fontSize: 11 }}
      title="Permanently delete this line"
    >
      Delete
    </button>
  );
}
