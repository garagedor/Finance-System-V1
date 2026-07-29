"use client";

// Top navigation for the AI Workspace — Command Center, the assistant, each
// executive, and the Action Center. Active state follows the URL.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EXECUTIVES } from "./executives";

type Tab = { href: string; label: string };

const TABS: Tab[] = [
  { href: "/portal/ai", label: "Command Center" },
  { href: "/portal/ai/ask", label: "Ask the Team" },
  ...EXECUTIVES.map((e) => ({ href: `/portal/ai/${e.slug}`, label: e.name })),
  { href: "/portal/ai/actions", label: "Action Center" },
  { href: "/portal/ai/detectors", label: "Detectors" },
  { href: "/portal/ai/voice", label: "Voice" },
];

export default function AiTabs() {
  const pathname = usePathname() || "";
  return (
    <nav
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        marginBottom: 18,
        paddingBottom: 4,
      }}
    >
      {TABS.map((t) => {
        const active =
          t.href === "/portal/ai"
            ? pathname === "/portal/ai"
            : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className="portal-range-pill"
            style={
              active
                ? {
                    background: "rgba(99,102,241,0.14)",
                    border: "1px solid rgba(99,102,241,0.35)",
                    color: "#c7d2fe",
                  }
                : undefined
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
