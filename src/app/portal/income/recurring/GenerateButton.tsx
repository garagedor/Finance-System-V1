"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateButton({ templateId, label }: { templateId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "err">("ok");

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const url = templateId
        ? `/api/portal/recurring-income/generate?_id=${encodeURIComponent(templateId)}`
        : "/api/portal/recurring-income/generate";
      const res = await fetch(url, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      const s = j.summary;
      setMsg(`+${s.total_generated} income · ${s.total_skipped} already existed · ${s.templates_processed} templates`);
      setTone("ok");
      router.refresh();
      setTimeout(() => setMsg(null), 8000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
      setTone("err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <button
        className={templateId ? "portal-btn" : "portal-btn portal-btn-primary"}
        onClick={run}
        disabled={busy}
        style={templateId ? { padding: "4px 10px", fontSize: 12 } : undefined}
      >
        {busy ? "Generating…" : label ?? (templateId ? "Generate now" : "↻ Generate due income")}
      </button>
      {msg && (
        <span style={{ fontSize: 12, color: tone === "ok" ? "#10b981" : "#f87171" }}>{msg}</span>
      )}
    </div>
  );
}
