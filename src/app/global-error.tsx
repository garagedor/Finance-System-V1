"use client";

// App-wide error boundary of last resort. Next.js renders this when an error
// is thrown ABOVE the nearest route-segment error.tsx — i.e. in the root
// layout or the <AuthShell> shell itself (which renders the Finance sidebar
// only on /portal/*). Those throws otherwise surface as a bare HTTP 500 with
// no on-page detail. This surfaces the real message + stack so the cause is
// visible instead of a blank 500.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#0a0f1c",
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "40px 24px",
        }}
      >
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Application Error
          </div>
          <h1 style={{ margin: "6px 0 16px", fontSize: 22 }}>
            Something crashed before the page could render
          </h1>
          <button
            onClick={reset}
            style={{
              marginBottom: 20,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(99,102,241,0.4)",
              background: "rgba(99,102,241,0.15)",
              color: "#c7d2fe",
              cursor: "pointer",
            }}
          >
            ↻ Try again
          </button>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#64748b",
              marginBottom: 6,
            }}
          >
            Technical detail
          </div>
          <pre
            style={{
              margin: 0,
              padding: 14,
              background: "#0d1526",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              fontSize: 12,
              color: "#fca5a5",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowX: "auto",
              maxHeight: 360,
              fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
            }}
          >
            {error?.message ?? "Unknown error"}
            {error?.digest ? `\n\nDigest: ${error.digest}` : ""}
            {error?.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </div>
      </body>
    </html>
  );
}
