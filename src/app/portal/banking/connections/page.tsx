import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type {
  BankAccountSyncedRecord,
  BankSyncLogRecord,
  ConnectedInstitutionRecord,
} from "@/types/finance-plaid";
import { isPlaidConfigured, getPlaidEnv } from "@/lib/plaid";
import { fmt$, fmtDate, fmtDateTime } from "../../format";
import { PageHeader, StatPill, CardShell, Empty } from "../../_components/page-helpers";
import PlaidLinkButton from "../PlaidLinkButton";
import SyncButton from "../SyncButton";
import DisconnectButton from "../DisconnectButton";
import BankingTabs from "../BankingTabs";

export const dynamic = "force-dynamic";

async function load() {
  await ensureFinanceIndexes();
  const [institutions, accounts, recentLogs] = await Promise.all([
    coll<ConnectedInstitutionRecord>(FINANCE_COLLECTIONS.plaidInstitution)
      .find({})
      .sort({ connected_at: -1 })
      .toArray(),
    coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced)
      .find({})
      .sort({ name: 1 })
      .toArray(),
    coll<BankSyncLogRecord>(FINANCE_COLLECTIONS.bankSyncLog)
      .find({})
      .sort({ started_at: -1 })
      .limit(10)
      .toArray(),
  ]);
  const totalBalance = accounts
    .filter((a) => a.active)
    .reduce((s, a) => s + (a.current_balance ?? 0), 0);
  const activeInstitutions = institutions.filter((i) => i.status !== "disconnected");
  return { institutions, accounts, recentLogs, totalBalance, activeInstitutions };
}

export default async function ConnectionsPage() {
  const d = await load();
  const plaidReady = isPlaidConfigured();
  const env = getPlaidEnv();

  return (
    <div className="portal-page">
      <PageHeader
        kicker="System · Banking"
        title="Bank Connections"
        subtitle={
          <>
            Plaid <strong>{env}</strong> mode · read-only · no money movement
          </>
        }
        actions={plaidReady ? <PlaidLinkButton /> : null}
      />

      <BankingTabs active="connections" />

      {!plaidReady && (
        <div className="portal-alert portal-alert-warn">
          <span>⚙</span>
          <div>
            <strong>Plaid not configured.</strong> Set <code className="mono">PLAID_CLIENT_ID</code> and{" "}
            <code className="mono">PLAID_SECRET</code> in <code className="mono">.env.local</code> to enable bank connections.
            Start in <code className="mono">PLAID_ENV=sandbox</code>.
          </div>
        </div>
      )}

      <section className="portal-grid-4">
        <StatPill label="Connected institutions" value={d.activeInstitutions.length.toLocaleString()} />
        <StatPill label="Linked accounts" value={d.accounts.filter((a) => a.active).length.toLocaleString()} />
        <StatPill label="Total balance (live)" value={fmt$(d.totalBalance)} />
        <StatPill
          label="Needs attention"
          value={d.institutions.filter((i) => i.status === "needs_login" || i.status === "error").length.toLocaleString()}
        />
      </section>

      <CardShell
        title="Connected institutions"
        subtitle={d.institutions.length === 0 ? "no banks linked" : `${d.institutions.length} total`}
      >
        {d.institutions.length === 0 ? (
          <Empty
            message={plaidReady
              ? "No banks connected yet. Link your first one."
              : "Configure Plaid to connect banks (see warning above)."}
            action={plaidReady ? <PlaidLinkButton label="+ Connect your first bank" /> : undefined}
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Institution</th>
                <th>Status</th>
                <th>Accounts</th>
                <th>Last sync</th>
                <th>Connected</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.institutions.map((inst) => {
                const accts = d.accounts.filter((a) => a.item_id === inst.item_id);
                const statusCls =
                  inst.status === "active"     ? "pill-paid" :
                  inst.status === "needs_login"? "pill-pending" :
                  inst.status === "error"      ? "pill-unpaid" :
                  "pill-draft";
                return (
                  <tr key={inst._id}>
                    <td>
                      <strong>{inst.institution_name ?? inst.institution_id ?? "—"}</strong>
                      <div className="muted small mono">{inst.item_id.slice(0, 12)}…</div>
                    </td>
                    <td>
                      <span className={`pill ${statusCls}`}>{inst.status}</span>
                      {inst.status_message && (
                        <div className="muted small" style={{ marginTop: 3 }}>{inst.status_message}</div>
                      )}
                    </td>
                    <td>
                      <div className="small">{accts.length} account{accts.length === 1 ? "" : "s"}</div>
                      {accts.length > 0 && (
                        <div className="muted small">
                          {accts.slice(0, 2).map((a) => `${a.name}${a.mask ? ` ··${a.mask}` : ""}`).join(", ")}
                          {accts.length > 2 && ` +${accts.length - 2}`}
                        </div>
                      )}
                    </td>
                    <td className="small mono muted">{inst.last_sync_at ? fmtDateTime(inst.last_sync_at) : "—"}</td>
                    <td className="small mono muted">{fmtDate(inst.connected_at)}</td>
                    <td className="right">
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {inst.status !== "disconnected" && (
                          <SyncButton itemId={inst.item_id} label="↻ Sync" />
                        )}
                        {inst.status === "needs_login" && (
                          <PlaidLinkButton updateAccessToken={inst.item_id} label="Reauth" />
                        )}
                        {inst.status !== "disconnected" && (
                          <DisconnectButton itemId={inst.item_id} institutionName={inst.institution_name} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>

      {d.accounts.filter((a) => a.active).length > 0 && (
        <CardShell title="Linked accounts" subtitle="Live balances from Plaid">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Institution</th>
                <th>Type</th>
                <th>Mask</th>
                <th className="right">Available</th>
                <th className="right">Current</th>
                <th className="right">Last refresh</th>
              </tr>
            </thead>
            <tbody>
              {d.accounts.filter((a) => a.active).map((a) => (
                <tr key={a._id}>
                  <td>
                    <strong>{a.name}</strong>
                    {a.official_name && a.official_name !== a.name && (
                      <div className="muted small">{a.official_name}</div>
                    )}
                  </td>
                  <td className="muted small">{a.institution_name ?? "—"}</td>
                  <td className="muted small">{a.subtype ?? a.type ?? "—"}</td>
                  <td className="mono small">{a.mask ? `··${a.mask}` : "—"}</td>
                  <td className="right money">{fmt$(a.available_balance)}</td>
                  <td className="right money" style={{ fontWeight: 600 }}>{fmt$(a.current_balance)}</td>
                  <td className="right small muted mono">{fmtDateTime(a.last_balance_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardShell>
      )}

      <CardShell title="Recent sync activity" subtitle={`${d.recentLogs.length} most recent`}>
        {d.recentLogs.length === 0 ? (
          <Empty message="No sync activity yet." />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Institution</th>
                <th>Kind</th>
                <th className="right">Added</th>
                <th className="right">Modified</th>
                <th className="right">Removed</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {d.recentLogs.map((l) => {
                const inst = d.institutions.find((i) => i.item_id === l.item_id);
                return (
                  <tr key={l._id}>
                    <td className="small mono">{fmtDateTime(l.started_at)}</td>
                    <td className="small">{inst?.institution_name ?? l.item_id.slice(0, 10)}</td>
                    <td className="small muted">{l.kind}</td>
                    <td className="right money money-pos">{l.added}</td>
                    <td className="right small">{l.modified}</td>
                    <td className="right small">{l.removed}</td>
                    <td>
                      {l.ok ? (
                        <span className="pill pill-paid">ok</span>
                      ) : (
                        <span className="pill pill-unpaid" title={l.error_message}>
                          {l.error_code ?? "error"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>

      <div className="portal-alert portal-alert-info">
        <span>🔒</span>
        <div>
          <strong>Read-only by design.</strong> The Finance Portal connects to Plaid using
          <code className="mono" style={{ margin: "0 4px" }}>transactions</code>
          product only. No transfer, ACH initiation, or payment endpoints are wired anywhere
          in this codebase. Access tokens are encrypted at rest with AES-256-GCM.{" "}
          <Link href="/portal/settings" style={{ color: "#818cf8" }}>Role access settings →</Link>
        </div>
      </div>
    </div>
  );
}
