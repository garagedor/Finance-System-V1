"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit {
  kind: string;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}
interface Group {
  kind: string;
  label: string;
  hits: Hit[];
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Cmd/Ctrl+K opens; Escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setQ("");
      setGroups([]);
      setActive(0);
    }
  }, [open]);

  const search = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setGroups([]);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/search?q=${encodeURIComponent(term.trim())}`);
      const j = await res.json();
      setGroups(j.groups ?? []);
      setActive(0);
    } finally {
      setBusy(false);
    }
  }, []);

  // Debounce
  useEffect(() => {
    const id = setTimeout(() => search(q), 180);
    return () => clearTimeout(id);
  }, [q, search]);

  // Flatten for keyboard nav
  const flat: Hit[] = groups.flatMap((g) => g.hits);

  function pick(h: Hit) {
    router.push(h.href);
    setOpen(false);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[active];
      if (hit) pick(hit);
    }
  }

  if (!open) return null;

  return (
    <div
      className="portal-modal-backdrop"
      onClick={() => setOpen(false)}
      style={{ alignItems: "flex-start", paddingTop: "12vh" }}
    >
      <div
        className="portal-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(640px, 92vw)", maxHeight: "70vh", display: "flex", flexDirection: "column", padding: 0 }}
      >
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #1f2940", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>⌘K</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search expenses, income, bank txns, jobs, reports…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "white",
              fontSize: 15,
            }}
          />
          {busy && <span className="muted small">…</span>}
        </div>
        <div style={{ overflowY: "auto", padding: 8 }}>
          {q.length < 2 && (
            <div className="muted small" style={{ padding: 16, textAlign: "center" }}>
              Type at least 2 characters to search.
            </div>
          )}
          {q.length >= 2 && groups.length === 0 && !busy && (
            <div className="muted small" style={{ padding: 16, textAlign: "center" }}>
              No matches.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.kind} style={{ marginBottom: 10 }}>
              <div className="muted small" style={{ padding: "6px 12px", textTransform: "uppercase", fontSize: 10, letterSpacing: "0.1em" }}>
                {g.label}
              </div>
              {g.hits.map((h) => {
                const idx = flat.indexOf(h);
                const isActive = idx === active;
                return (
                  <button
                    key={`${h.kind}-${h.id}`}
                    onClick={() => pick(h)}
                    onMouseEnter={() => setActive(idx)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      background: isActive ? "rgba(99,102,241,0.16)" : "transparent",
                      border: "1px solid transparent",
                      borderLeft: isActive ? "3px solid #6366f1" : "3px solid transparent",
                      borderRadius: 6,
                      color: "#e2e8f0",
                      fontFamily: "inherit",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <div>{h.label}</div>
                    {h.sublabel && <div className="muted small">{h.sublabel}</div>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 12px", borderTop: "1px solid #1f2940", fontSize: 11, color: "#64748b", display: "flex", gap: 12 }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
