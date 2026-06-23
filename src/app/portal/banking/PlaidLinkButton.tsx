"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

const LINK_TOKEN_KEY = "plaid_link_token_pending";

export default function PlaidLinkButton({
  updateAccessToken,
  label,
}: {
  updateAccessToken?: string;
  label?: string;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "loading" | "linking" | "exchanging" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Auto-resume after OAuth: if we landed back on this page from the bank
  // with ?oauth_state_id=… in the URL, re-open Link with the stored token.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_state_id")) {
      const stored = sessionStorage.getItem(LINK_TOKEN_KEY);
      if (stored) {
        setLinkToken(stored);
        setReceivedRedirectUri(window.location.href);
        setStatus("linking");
      }
    }
  }, []);

  // Fetch link token on click (don't pre-fetch — token has 4h expiry)
  const startLink = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/portal/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateAccessToken ? { access_token: updateAccessToken } : {}),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Link token failed");
      // Persist so we can resume after OAuth redirect (Chase / BoA / WF flow)
      try { sessionStorage.setItem(LINK_TOKEN_KEY, j.link_token); } catch { /* ignore */ }
      setLinkToken(j.link_token);
      setStatus("linking");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStatus("error");
    }
  }, [updateAccessToken]);

  const onSuccess = useCallback(
    async (public_token: string) => {
      setStatus("exchanging");
      try {
        const res = await fetch("/api/portal/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Exchange failed");
        setStatus("done");
        try { sessionStorage.removeItem(LINK_TOKEN_KEY); } catch { /* ignore */ }
        // After exchange, kick off an initial sync to fetch transactions
        await fetch(`/api/portal/plaid/sync?item_id=${encodeURIComponent(j.item_id)}`, {
          method: "POST",
        });
        // Clean OAuth params from URL
        if (window.location.search.includes("oauth_state_id")) {
          window.history.replaceState({}, "", window.location.pathname);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Exchange failed");
        setStatus("error");
      }
    },
    [router]
  );

  const onExit = useCallback(() => {
    setLinkToken(null);
    setStatus((s) => (s === "linking" ? "idle" : s));
    try { sessionStorage.removeItem(LINK_TOKEN_KEY); } catch { /* ignore */ }
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    receivedRedirectUri,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (linkToken && ready && status === "linking") {
      open();
    }
  }, [linkToken, ready, status, open]);

  const isBusy = status === "loading" || status === "linking" || status === "exchanging";

  return (
    <>
      <button
        className={updateAccessToken ? "portal-btn" : "portal-btn portal-btn-primary"}
        onClick={startLink}
        disabled={isBusy}
        style={updateAccessToken ? { padding: "4px 10px", fontSize: 12 } : undefined}
      >
        {isBusy
          ? status === "exchanging"
            ? "Connecting…"
            : "Opening Plaid…"
          : label ?? (updateAccessToken ? "Reconnect" : "+ Connect bank")}
      </button>
      {error && (
        <span style={{ marginLeft: 10, fontSize: 12, color: "#f87171" }}>
          {error}
        </span>
      )}
    </>
  );
}
