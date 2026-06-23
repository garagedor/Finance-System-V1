"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DisconnectButton({ itemId, institutionName }: { itemId: string; institutionName?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    const sure = confirm(
      `Disconnect ${institutionName ?? "this institution"}?\n\nNo bank data is deleted — historical transactions stay searchable. Plaid stops sending updates.`
    );
    if (!sure) return;
    setBusy(true);
    try {
      await fetch(`/api/portal/plaid/institutions?item_id=${encodeURIComponent(itemId)}&revoke=1`, {
        method: "DELETE",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="portal-btn portal-btn-danger"
      onClick={onClick}
      disabled={busy}
      style={{ padding: "4px 10px", fontSize: 12 }}
    >
      {busy ? "…" : "Disconnect"}
    </button>
  );
}
