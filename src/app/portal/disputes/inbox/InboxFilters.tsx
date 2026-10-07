"use client";

// Inbox filter bar. Uses the searchable FilterMultiSelect (same clean control as
// the ledger/report filters) and navigates with the chosen params so the server
// page filters. No Status control: workflow state is the tab, not a filter —
// ignored) on the Refunds & Disputes tabs.

import { useState } from "react";
import { useRouter } from "next/navigation";
import FilterMultiSelect from "../../_components/FilterMultiSelect";

type Opts = { techs: string[]; providers: string[]; ams: string[] };
type Init = { q: string; tech: string[]; provider: string[]; am: string[]; matched: string[]; from: string; to: string; min: string; max: string };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const MATCH = ["Matched", "Unmatched"];
const fieldWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };

export default function InboxFilters({ view, kind, initial, options, clearHref }: {
  view: string; kind: string; initial: Init; options: Opts; clearHref: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [tech, setTech] = useState<string[]>(initial.tech);
  const [provider, setProvider] = useState<string[]>(initial.provider);
  const [am, setAm] = useState<string[]>(initial.am);
  const [matched, setMatched] = useState<string[]>(initial.matched.map(cap));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [min, setMin] = useState(initial.min);
  const [max, setMax] = useState(initial.max);

  function apply() {
    const p = new URLSearchParams();
    p.set("view", view);
    if (view === "action" || view === "posted" || view === "ignored") p.set("kind", kind);
    if (q.trim()) p.set("q", q.trim());
    tech.forEach((x) => p.append("tech", x));
    provider.forEach((x) => p.append("provider", x));
    am.forEach((x) => p.append("am", x));
    matched.forEach((x) => p.append("matched", x.toLowerCase()));
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (min) p.set("min", min);
    if (max) p.set("max", max);
    router.push(`/portal/disputes/inbox?${p.toString()}`);
  }

  return (
    <div className="portal-card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
      <label style={fieldWrap}>
        <span className="portal-label" style={{ fontSize: 11 }}>Search</span>
        <input className="portal-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} placeholder="invoice / customer / address" style={{ minWidth: 200 }} />
      </label>
      <FilterMultiSelect label="Technician" values={tech} onChange={setTech} options={options.techs} />
      <FilterMultiSelect label="Provider" values={provider} onChange={setProvider} options={options.providers} />
      <FilterMultiSelect label="Area Manager" values={am} onChange={setAm} options={options.ams} />
      <FilterMultiSelect label="Match" values={matched} onChange={setMatched} options={MATCH} />
      <label style={fieldWrap}><span className="portal-label" style={{ fontSize: 11 }}>From</span><input type="date" className="portal-input" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: "6px 8px" }} /></label>
      <label style={fieldWrap}><span className="portal-label" style={{ fontSize: 11 }}>To</span><input type="date" className="portal-input" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: "6px 8px" }} /></label>
      <label style={fieldWrap}><span className="portal-label" style={{ fontSize: 11 }}>Min $</span><input type="number" step="0.01" className="portal-input" value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 84, padding: "6px 8px" }} /></label>
      <label style={fieldWrap}><span className="portal-label" style={{ fontSize: 11 }}>Max $</span><input type="number" step="0.01" className="portal-input" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 84, padding: "6px 8px" }} /></label>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="portal-btn portal-btn-primary" onClick={apply}>Apply</button>
        <button type="button" className="portal-btn portal-btn-ghost" onClick={() => router.push(clearHref)}>Clear</button>
      </div>
    </div>
  );
}
