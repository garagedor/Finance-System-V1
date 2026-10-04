"use client";

// Live controller for the inbox. On open it kicks a ScanPay sync (disputes +
// refunds) so the list is current the moment you look, then re-reads the page
// every ~15s (router.refresh re-runs the server component, picking up anything
// the background cron pulled). Shows a "Live · updated Xs ago" pill + Sync now.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const REFRESH_SECONDS = 15;

export default function InboxLive() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [ago, setAgo] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const running = useRef(false);

  const sync = useCallback(async (manual: boolean) => {
    if (running.current) return;
    running.current = true;
    setSyncing(true); setNote(null);
    try {
      const [rf, dp] = await Promise.all([
        fetch("/api/portal/scanpay/refunds/sync", { method: "POST" }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/portal/scanpay/sync", { method: "POST" }).then((r) => r.json()).catch(() => ({})),
      ]);
      if (manual) {
        const nR = rf?.summary?.new ?? rf?.summary?.inserted ?? 0;
        const nD = dp?.summary?.new ?? dp?.summary?.inserted ?? 0;
        setNote(`Synced · ${nR} new refund${nR === 1 ? "" : "s"}, ${nD} new dispute${nD === 1 ? "" : "s"}`);
      }
      setAgo(0);
      router.refresh();
    } catch {
      if (manual) setNote("Sync failed — try again");
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [router]);

  // Sync once when the inbox opens.
  useEffect(() => { void sync(false); }, [sync]);

  // Tick the "updated Xs ago" label; every REFRESH_SECONDS re-read the page, and
  // every 60s pull fresh data from ScanPay in the background (incremental) so the
  // inbox stays live while it's open — no dependency on the server cron cadence.
  useEffect(() => {
    const t = setInterval(() => {
      setAgo((a) => {
        if (a + 1 >= REFRESH_SECONDS) { router.refresh(); return 0; }
        return a + 1;
      });
    }, 1000);
    const s = setInterval(() => { void sync(false); }, 60000);
    return () => { clearInterval(t); clearInterval(s); };
  }, [router, sync]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 999, padding: "4px 10px", fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", display: "inline-block" }} />
        Live · updated {ago}s ago
      </span>
      {note && <span className="muted small">{note}</span>}
      <button type="button" className="portal-btn" onClick={() => sync(true)} disabled={syncing}>
        {syncing ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
