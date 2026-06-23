// Rendered at the top of any portal page when the Mongo connection failed.
// Surfaces the most likely fix (Atlas IP allow-list / cluster paused).

import type { ReactNode } from "react";

export function DbDownBanner({ error }: { error: string | null }) {
  return (
    <div className="portal-alert portal-alert-error">
      <span>⚠</span>
      <div style={{ flex: 1 }}>
        <strong>Couldn&apos;t reach the database.</strong> Most common cause: your dev machine&apos;s
        IP isn&apos;t on the MongoDB Atlas allow-list, or the cluster is paused.
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", fontSize: 12 }}>How to fix</summary>
          <ol style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20, fontSize: 12.5, lineHeight: 1.7 }}>
            <li>Open <code className="mono">https://cloud.mongodb.com</code> and log in</li>
            <li>Go to <strong>Network Access</strong> → <strong>+ ADD IP ADDRESS</strong></li>
            <li>Choose <em>Add Current IP Address</em>, or <code className="mono">0.0.0.0/0</code> for dev (allow anywhere)</li>
            <li>Wait ~1 minute, then refresh this page</li>
            <li>If the cluster shows <em>Paused</em> on the Atlas dashboard, click <em>Resume</em></li>
          </ol>
        </details>
        {error && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", fontSize: 12 }}>Technical detail</summary>
            <pre
              style={{
                margin: "6px 0 0",
                padding: 10,
                background: "rgba(0,0,0,0.3)",
                borderRadius: 6,
                fontSize: 10.5,
                color: "#fca5a5",
                overflowX: "auto",
                fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
              }}
            >
              {error}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

/** Wrap a server-component body that depends on DB data. If `data` is null, show banner + fallback. */
export function DbGuard({
  data,
  error,
  fallback,
  children,
}: {
  data: unknown;
  error: string | null;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  if (data === null) {
    return (
      <div className="portal-page">
        <DbDownBanner error={error} />
        {fallback}
      </div>
    );
  }
  return <>{children}</>;
}
