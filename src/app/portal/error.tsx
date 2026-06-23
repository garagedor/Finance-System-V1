"use client";

// Portal-wide error boundary. Catches any error thrown by a server
// component inside /portal/*. The most common case is a MongoDB connection
// failure (Atlas IP allow-list / cluster paused) — we surface the fix path.

import { useEffect } from "react";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal error boundary]", error);
  }, [error]);

  const message = error?.message ?? "Unknown error";
  const isMongoTLS =
    /tlsv1 alert internal error|ERR_SSL_TLSV1|MongoNetwork|MongoServerSelection|ECONNREFUSED|getaddrinfo|ETIMEDOUT/i.test(
      message
    );
  const isPlaid =
    /plaid/i.test(message) || /PLAID_/.test(message);

  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-header-left">
          <span className="portal-kicker">Error</span>
          <h1 className="portal-title">Something went wrong on this page</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="portal-btn portal-btn-primary" onClick={reset}>
            ↻ Try again
          </button>
        </div>
      </header>

      {isMongoTLS && (
        <div className="portal-alert portal-alert-error">
          <span>⚠</span>
          <div style={{ flex: 1 }}>
            <strong>The database is unreachable.</strong> Most common cause: your dev machine&apos;s
            IP isn&apos;t on the MongoDB Atlas allow-list, or the cluster is paused.

            <ol style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
              <li>Open <a href="https://cloud.mongodb.com" target="_blank" rel="noreferrer" style={{ color: "#818cf8" }}>cloud.mongodb.com</a> and log in</li>
              <li>Your project → <strong>Network Access</strong> → <strong>+ ADD IP ADDRESS</strong></li>
              <li>Choose <em>Add Current IP Address</em> (or <code className="mono">0.0.0.0/0</code> for dev = anywhere)</li>
              <li>If <strong>Database</strong> shows the cluster <em>Paused</em>, click <strong>Resume</strong></li>
              <li>Wait ~1 minute → press <strong>Try again</strong> above</li>
            </ol>
          </div>
        </div>
      )}

      {isPlaid && (
        <div className="portal-alert portal-alert-warn">
          <span>⚙</span>
          <div>
            <strong>Plaid not fully configured.</strong> Set the <code className="mono">PLAID_*</code> env
            variables in <code className="mono">.env.local</code>, restart the dev server, and try again.
            See <code className="mono">.env.example</code> for the full set.
          </div>
        </div>
      )}

      <div className="portal-card">
        <div className="portal-section-label" style={{ marginBottom: 8 }}>Technical detail</div>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "#0a0f1c",
            borderRadius: 8,
            fontSize: 11.5,
            color: "#fca5a5",
            overflowX: "auto",
            maxHeight: 280,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
          }}
        >
          {message}
          {error.digest && `\n\nDigest: ${error.digest}`}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      </div>
    </div>
  );
}
