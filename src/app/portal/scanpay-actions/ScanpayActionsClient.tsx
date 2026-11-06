"use client";

import { useCallback, useEffect, useState } from "react";
import "./scanpay-actions.css";

type Job = { _id: string; date?: string; address?: string; clientName?: string; tech?: string; location?: string; status?: string; invoiceNumber?: string; totalAmount?: number | string; totalPaidCard?: number | string };
type Payment = { id: string; amount: number; createdAt: string | null; paymentMethod: string | null; status: string | null; refunded: number; refundable: number };
type Invoice = { team: number; id: string; invoiceNumber: string; status: string; isPaid: boolean; amount: number; memberId: string | null; createdAt: string | null };
type Member = { memberId: string; name: string; role?: string };
type Action = { _id: string; action: string; status: string; invoiceNumber: string | null; paymentId: string | null; amount: number | null; memberName: string | null; actor: string; error: string | null; created_at: string };
type Detail = {
  job: Job;
  defaults: { team: number; accounts: number[]; accountNames: Record<number, string>; member: { memberId: string; name: string; why: string } | null; members: Member[] };
  invoice: Invoice | null;
  payments: Payment[];
  actions: Action[];
};
type Modal =
  | { kind: "create" }
  | { kind: "link" }
  | { kind: "paid" }
  | { kind: "refund"; payment: Payment }
  | null;

const money = (n: number | string | undefined | null) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s?: string | null) => (s ? String(s).slice(0, 10) : "—");
const ACTION_LABEL: Record<string, string> = { "create-invoice": "Invoice created", "link-invoice": "Invoice linked", "mark-paid": "Marked paid", refund: "Refund" };
const PAID_LABEL: Record<string, string> = { "m-cash": "Cash", "m-check": "Check", "m-direct-transfer": "Direct transfer", "m-other": "Other" };

async function api<T>(init?: { q?: string; jobId?: string; log?: boolean; body?: unknown }): Promise<T> {
  const url = init?.body ? "/api/portal/scanpay/actions"
    : `/api/portal/scanpay/actions?${new URLSearchParams(init?.q ? { q: init.q } : init?.jobId ? { jobId: init.jobId } : { log: "1" })}`;
  const res = await fetch(url, init?.body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : undefined);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  return j as T;
}

export default function ScanpayActionsClient() {
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [log, setLog] = useState<Action[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  const loadLog = useCallback(() => { api<{ rows: Action[] }>({ log: true }).then((r) => setLog(r.rows)).catch(() => {}); }, []);
  useEffect(loadLog, [loadLog]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true); setError(null);
    try { setJobs((await api<{ jobs: Job[] }>({ q: q.trim() })).jobs); }
    catch (err) { setError(err instanceof Error ? err.message : "Search failed"); }
    finally { setSearching(false); }
  };
  const openJob = async (id: string) => {
    setLoadingJob(true); setError(null); setFlash(null);
    try { setDetail(await api<Detail>({ jobId: id })); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load the job"); }
    finally { setLoadingJob(false); }
  };
  const done = (msg: string) => { setModal(null); setFlash(msg); loadLog(); if (detail) openJob(detail.job._id); };

  return (
    <div className="spa">
      <form className="spa-search" onSubmit={search}>
        <input className="portal-input" placeholder="Find a job — address, customer, phone or IN number" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="portal-btn portal-btn-primary" type="submit" disabled={searching || q.trim().length < 2}>{searching ? "Searching…" : "Search"}</button>
      </form>
      {error && <div className="portal-alert portal-alert-error">{error}</div>}
      {flash && <div className="spa-flash">{flash}</div>}

      {jobs.length > 0 && !detail && (
        <div className="spa-results">
          {jobs.map((j) => (
            <button key={j._id} type="button" className="spa-result" onClick={() => openJob(j._id)}>
              <span className="spa-result-main">{j.clientName || "—"} · {j.address || "—"}</span>
              <span className="spa-result-sub">{day(j.date)} · {j.tech || "—"} · {j.location || "—"} · {j.status || "—"} · {j.invoiceNumber || "no invoice"}</span>
            </button>
          ))}
        </div>
      )}

      {loadingJob && <div className="muted small">Loading the job from ScanPay…</div>}

      {detail && (
        <div className="spa-job">
          <div className="spa-job-head">
            <div>
              <div className="spa-job-title">{detail.job.clientName || "—"} · {detail.job.address || "—"}</div>
              <div className="spa-job-sub">{day(detail.job.date)} · {detail.job.tech || "—"} · {detail.job.location || "—"} · {detail.job.status || "—"} · card {money(detail.job.totalPaidCard)}</div>
            </div>
            <button type="button" className="portal-btn" onClick={() => setDetail(null)}>← Back to results</button>
          </div>

          <div className="spa-grid">
            <section className="spa-card">
              <h3>ScanPay invoice</h3>
              {detail.invoice ? (
                <dl className="spa-dl">
                  <dt>Invoice</dt><dd className="mono">{detail.invoice.invoiceNumber}</dd>
                  <dt>ScanPay account</dt><dd>{detail.defaults.accountNames[detail.invoice.team] ?? `Account ${detail.invoice.team}`}</dd>
                  <dt>Amount</dt><dd>{money(detail.invoice.amount)}</dd>
                  <dt>Status</dt><dd>{detail.invoice.isPaid ? "Paid" : detail.invoice.status || "Unpaid"}</dd>
                </dl>
              ) : detail.job.invoiceNumber ? (
                <p className="muted small">{detail.job.invoiceNumber} is on the job but wasn&apos;t found in ScanPay.</p>
              ) : (
                <p className="muted small">No ScanPay invoice on this job yet.</p>
              )}
              <div className="spa-actions">
                <button type="button" className="portal-btn portal-btn-primary" onClick={() => setModal({ kind: "create" })}>Create &amp; send invoice</button>
                <button type="button" className="portal-btn" onClick={() => setModal({ kind: "link" })}>{detail.job.invoiceNumber ? "Change linked invoice" : "Link existing invoice"}</button>
                {detail.invoice && !detail.invoice.isPaid && (
                  <button type="button" className="portal-btn" onClick={() => setModal({ kind: "paid" })}>Mark paid</button>
                )}
              </div>
            </section>

            <section className="spa-card">
              <h3>Payments</h3>
              {detail.payments.length === 0 ? <p className="muted small">No card payments on this invoice.</p> : (
                <table className="spa-table">
                  <thead><tr><th>Payment</th><th>Date</th><th>Status</th><th className="r">Paid</th><th className="r">Refunded</th><th /></tr></thead>
                  <tbody>
                    {detail.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.id}</td>
                        <td>{day(p.createdAt)}</td>
                        <td className={/fail|declin|void|cancel/i.test(p.status ?? "") ? "spa-bad" : ""}>{p.status ?? "—"}</td>
                        <td className="r">{money(p.amount)}</td>
                        <td className="r">{p.refunded ? money(p.refunded) : "—"}</td>
                        <td className="r">
                          <button type="button" className="spa-danger-btn" disabled={p.refundable <= 0} onClick={() => setModal({ kind: "refund", payment: p })}>
                            Refund…
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {detail.actions.length > 0 && (
            <section className="spa-card">
              <h3>Actions on this job</h3>
              <ActionList rows={detail.actions} />
            </section>
          )}
        </div>
      )}

      <section className="spa-card">
        <h3>Recent ScanPay actions</h3>
        {log.length === 0 ? <p className="muted small">Nothing yet.</p> : <ActionList rows={log} />}
      </section>

      {modal && detail && (
        <div className="spa-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="spa-modal">
            {modal.kind === "create" && <CreateInvoice d={detail} onClose={() => setModal(null)} onDone={done} />}
            {modal.kind === "link" && <LinkInvoice d={detail} onClose={() => setModal(null)} onDone={done} />}
            {modal.kind === "paid" && detail.invoice && <MarkPaid inv={detail.invoice} onClose={() => setModal(null)} onDone={done} />}
            {modal.kind === "refund" && <Refund p={modal.payment} onClose={() => setModal(null)} onDone={done} />}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionList({ rows }: { rows: Action[] }) {
  return (
    <table className="spa-table">
      <thead><tr><th>When</th><th>Action</th><th>Invoice / payment</th><th className="r">Amount</th><th>By</th><th>Result</th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a._id}>
            <td>{a.created_at.slice(0, 16).replace("T", " ")}</td>
            <td>{ACTION_LABEL[a.action] ?? a.action}</td>
            <td className="mono">{a.invoiceNumber || a.paymentId || "—"}</td>
            <td className="r">{a.amount != null ? money(a.amount) : "—"}</td>
            <td>{a.actor}{a.memberName ? ` · as ${a.memberName}` : ""}</td>
            <td className={a.status === "ok" ? "spa-ok" : a.status === "error" ? "spa-bad" : ""}>{a.status === "ok" ? "Done" : a.status === "error" ? a.error ?? "Failed" : "Running…"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Footer({ busy, err, onClose, label, danger, disabled, onGo }: { busy: boolean; err: string | null; onClose: () => void; label: string; danger?: boolean; disabled?: boolean; onGo: () => void }) {
  return (
    <>
      {err && <div className="portal-alert portal-alert-error">{err}</div>}
      <div className="spa-modal-foot">
        <button type="button" className="portal-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={danger ? "spa-danger-go" : "portal-btn portal-btn-primary"} onClick={onGo} disabled={busy || disabled}>{busy ? "Working…" : label}</button>
      </div>
    </>
  );
}

function useAction(onDone: (m: string) => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (body: Record<string, unknown>, msg: (r: any) => string) => {
    setBusy(true); setErr(null);
    try { const r = await api<{ result: unknown }>({ body }); onDone(msg(r.result)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };
  return { busy, err, go };
}

function CreateInvoice({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState(String(Number(d.job.totalAmount) || ""));
  const [desc, setDesc] = useState(`Garage door service — ${d.job.address ?? ""}`.trim());
  const [team, setTeam] = useState(d.defaults.team);
  const [memberId, setMemberId] = useState(d.defaults.member?.memberId ?? "");
  const [tip, setTip] = useState(true);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [result, setResult] = useState<any>(null);
  const { busy, err, go } = useAction(() => {});
  const member = d.defaults.members.find((m) => m.memberId === memberId);
  const amt = Number(amount);

  if (result) {
    return (
      <>
        <h3>Invoice {result.invoiceNumber} created</h3>
        <p className="small">{d.defaults.accountNames[result.team] ?? `Account ${result.team}`} · created as {result.memberName}{result.linkedToJob ? " · linked to this job" : " · the job already had another invoice, so it wasn't relinked"}</p>
        {result.checkoutUrl && <p><a href={result.checkoutUrl} target="_blank" rel="noreferrer">Open the payment page</a> — send this link to the customer, or show it as a QR code.</p>}
        {result.deepLink && <p><a href={result.deepLink}>Open in the ScanPay app</a> (on the tech&apos;s phone) to take the payment.</p>}
        <div className="spa-modal-foot"><button type="button" className="portal-btn portal-btn-primary" onClick={() => onDone(`Invoice ${result.invoiceNumber} created.`)}>Done</button></div>
      </>
    );
  }
  const submit = async () => {
    await go({ action: "create-invoice", jobId: d.job._id, amount: amt, description: desc, team, memberId, tipEnabled: tip }, (r) => { setResult(r); return ""; });
  };
  return (
    <>
      <h3>Create &amp; send a ScanPay invoice</h3>
      {step === "form" ? (
        <>
          <label className="portal-label">Amount to charge</label>
          <input className="portal-input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="portal-label">Description (shown to the customer)</label>
          <input className="portal-input" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div className="spa-two">
            <div>
              <label className="portal-label">ScanPay account</label>
              <select className="portal-input" value={team} onChange={(e) => setTeam(Number(e.target.value))}>
                {d.defaults.accounts.map((t) => <option key={t} value={t}>{d.defaults.accountNames[t] ?? `Account ${t}`}{t === d.defaults.team ? " (this location)" : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="portal-label">Create as</label>
              <select className="portal-input" value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={team !== d.defaults.team}>
                {d.defaults.members.map((m) => <option key={m.memberId} value={m.memberId}>{m.name}{m.memberId === d.defaults.member?.memberId ? (d.defaults.member?.why === "tech" ? " (job tech)" : " (owner)") : ""}</option>)}
              </select>
            </div>
          </div>
          <label className="spa-check"><input type="checkbox" checked={tip} onChange={(e) => setTip(e.target.checked)} /> Let the customer add a tip</label>
          <p className="muted small">Only the person it&apos;s created as can later mark it paid in ScanPay.</p>
          <Footer busy={busy} err={err} onClose={onClose} label="Review" disabled={!(amt > 0) || !memberId} onGo={() => setStep("confirm")} />
        </>
      ) : (
        <>
          <div className="spa-confirm">
            <div>This will create a customer and an invoice in ScanPay account <b>{d.defaults.accountNames[team] ?? team}</b>:</div>
            <ul>
              <li>Customer: <b>{d.job.clientName || "—"}</b>{d.job.address ? ` · ${d.job.address}` : ""}</li>
              <li>Amount: <b>{money(amt)}</b>{tip ? " + optional tip" : ""}</li>
              <li>Created as: <b>{member?.name ?? "—"}</b></li>
              <li>{d.job.invoiceNumber ? `The job keeps its current invoice (${d.job.invoiceNumber}).` : "The new invoice number is saved on this job."}</li>
            </ul>
          </div>
          <Footer busy={busy} err={err} onClose={() => setStep("form")} label="Create invoice" onGo={submit} />
        </>
      )}
    </>
  );
}

function LinkInvoice({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (m: string) => void }) {
  const [inv, setInv] = useState("");
  const { busy, err, go } = useAction(onDone);
  const replace = !!d.job.invoiceNumber;
  return (
    <>
      <h3>{replace ? "Change the linked invoice" : "Link an existing ScanPay invoice"}</h3>
      <p className="small">The CRM checks the invoice exists in ScanPay and isn&apos;t on another job, then saves it on this job. ScanPay itself isn&apos;t changed.</p>
      {replace && <p className="small">Currently linked: <span className="mono">{d.job.invoiceNumber}</span> (kept in the job&apos;s history).</p>}
      <label className="portal-label">Invoice number</label>
      <input className="portal-input mono" placeholder="IN-…" value={inv} onChange={(e) => setInv(e.target.value)} />
      <Footer busy={busy} err={err} onClose={onClose} label="Link invoice" disabled={!/^IN-/i.test(inv.trim())}
        onGo={() => go({ action: "link-invoice", jobId: d.job._id, invoiceNumber: inv.trim(), replace }, (r) => `Linked ${r.invoiceNumber} (${d.defaults.accountNames[r.team] ?? `account ${r.team}`}).`)} />
    </>
  );
}

function MarkPaid({ inv, onClose, onDone }: { inv: Invoice; onClose: () => void; onDone: (m: string) => void }) {
  const [method, setMethod] = useState("m-cash");
  const [receipt, setReceipt] = useState(false);
  const { busy, err, go } = useAction(onDone);
  return (
    <>
      <h3>Mark {inv.invoiceNumber} as paid</h3>
      <p className="small">Records a payment outside the card — {money(inv.amount)}. ScanPay allows it only as the person who created the invoice; the CRM does it in their name.</p>
      <label className="portal-label">Paid by</label>
      <select className="portal-input" value={method} onChange={(e) => setMethod(e.target.value)}>
        {Object.entries(PAID_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <label className="spa-check"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /> Send the customer a receipt</label>
      <Footer busy={busy} err={err} onClose={onClose} label="Mark paid"
        onGo={() => go({ action: "mark-paid", invoiceNumber: inv.invoiceNumber, method, sendReceipt: receipt }, () => `${inv.invoiceNumber} marked paid (${PAID_LABEL[method]}).`)} />
    </>
  );
}

function Refund({ p, onClose, onDone }: { p: Payment; onClose: () => void; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState("");
  const [again, setAgain] = useState("");
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const { busy, err, go } = useAction(onDone);
  const a = Number(amount);
  const ok = a > 0 && a <= p.refundable + 0.005 && reason.trim().length > 2;
  return (
    <>
      <h3 className="spa-bad">Refund — sends real money back to the customer</h3>
      <p className="small">Payment <span className="mono">{p.id}</span> · paid {money(p.amount)} · already refunded {money(p.refunded)} · <b>at most {money(p.refundable)}</b> left.</p>
      {step === "form" ? (
        <>
          <label className="portal-label">Refund amount</label>
          <input className="portal-input" type="number" step="0.01" min="0" max={p.refundable} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="portal-label">Reason (kept in ScanPay)</label>
          <input className="portal-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Footer busy={busy} err={err} onClose={onClose} label="Continue" danger disabled={!ok} onGo={() => setStep("confirm")} />
        </>
      ) : (
        <>
          <div className="spa-confirm spa-confirm-danger">
            You are about to refund <b>{money(a)}</b> to the customer&apos;s card. This can&apos;t be undone from the CRM.
            <label className="portal-label" style={{ marginTop: 10 }}>Type the amount again to confirm</label>
            <input className="portal-input" type="number" step="0.01" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
          <Footer busy={busy} err={err} onClose={() => setStep("form")} label={`Refund ${money(a)}`} danger
            disabled={Math.abs(Number(again) - a) >= 0.005}
            onGo={() => go({ action: "refund", paymentId: p.id, amount: a, confirmAmount: Number(again), reason }, (r) => `Refund of ${money(r.amount)} sent to ScanPay${r.status ? ` (${r.status})` : ""}.`)} />
        </>
      )}
    </>
  );
}
