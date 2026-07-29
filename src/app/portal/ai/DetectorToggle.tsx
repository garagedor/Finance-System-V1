"use client";

import { useState } from "react";

// A single detector's enable/disable switch. Posts to the detectors API.
export default function DetectorToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setBusy(true);
    setOn(next);
    try {
      const res = await fetch("/api/portal/ai/detectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setOn(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={on ? "Enabled — click to disable" : "Disabled — click to enable"}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: "none",
        cursor: busy ? "wait" : "pointer",
        background: on ? "rgba(52,211,153,0.9)" : "rgba(255,255,255,0.14)",
        position: "relative",
        transition: "background 0.15s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
}
