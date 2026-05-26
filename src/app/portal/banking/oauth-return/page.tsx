// Plaid OAuth return landing.
// After the user authenticates at the bank (Chase / BoA / Wells / etc.),
// Plaid redirects the browser back here with ?oauth_state_id=… in the URL.
// The PlaidLinkButton on this page auto-detects the param, pulls the
// link_token from sessionStorage, and re-opens Link with `receivedRedirectUri`
// so Plaid can complete the flow.

"use client";

import { Suspense } from "react";
import Link from "next/link";
import PlaidLinkButton from "../PlaidLinkButton";

export default function OAuthReturnPage() {
  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-header-left">
          <span className="portal-kicker">Banking · OAuth return</span>
          <h1 className="portal-title">Finishing bank connection…</h1>
          <p className="portal-subtitle">
            Plaid is completing the link. This usually takes a second or two.
          </p>
        </div>
      </header>

      <div className="portal-card">
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          If the Plaid window doesn&apos;t re-open automatically, click the button below.
        </p>
        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          {/* The button auto-resumes via useEffect when ?oauth_state_id is present */}
          <Suspense fallback={<button className="portal-btn" disabled>Resuming…</button>}>
            <PlaidLinkButton label="Resume connection" />
          </Suspense>
          <Link href="/portal/banking/connections" className="portal-btn portal-btn-ghost">
            Cancel and go back
          </Link>
        </div>
      </div>

      <div className="portal-alert portal-alert-info">
        <span>ℹ</span>
        <div>
          If you see this page for more than 10 seconds without a Plaid window appearing,
          the link token expired. Go back to{" "}
          <Link href="/portal/banking/connections" style={{ color: "#818cf8" }}>Connections</Link>{" "}
          and start over.
        </div>
      </div>
    </div>
  );
}
