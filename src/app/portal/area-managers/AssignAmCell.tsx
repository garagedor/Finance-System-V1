"use client";

// Inline Area-Manager assignment for a Location. Type a name (with suggestions
// from existing AMs) and Save — this is what the dispute/refund engine resolves.

import { useState } from "react";
import { useRouter } from "next/navigation";

const LIST_ID = "am-name-options";

export default function AssignAmCell({
  location,
  current,
  options,
}: {
  location: string;
  current: string;
  options: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = value.trim() !== (current ?? "").trim();

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/portal/locations/area-manager", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, areaManagerName: value.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setMsg("Saved");
      router.refresh();
      setTimeout(() => setMsg(null), 3000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input
        list={LIST_ID}
        className="portal-input"
        value={value}
        disabled={busy}
        placeholder="— unassigned —"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && dirty) save(); }}
        style={{ padding: "4px 8px", fontSize: 12, width: 150, borderColor: current ? undefined : "rgba(248,113,113,0.5)" }}
      />
      <datalist id={LIST_ID}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
      {dirty && (
        <button className="portal-btn portal-btn-primary" style={{ padding: "3px 9px", fontSize: 11 }} onClick={save} disabled={busy}>
          {busy ? "…" : "Save"}
        </button>
      )}
      {msg && <span className="small" style={{ color: msg === "Saved" ? "#34d399" : "#f87171" }}>{msg}</span>}
    </span>
  );
}
