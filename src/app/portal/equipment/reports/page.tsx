import Link from "next/link";
import { readSession, hasPermission } from "@/lib/rbac";
import { equipmentReport } from "@/lib/equipment/reporting";
import { fmt$, fmtDate, lastNDays } from "../../format";
import { PageHeader, CardShell, Empty, StatPill, FilterBar, FilterField } from "../../_components/page-helpers";
import EquipmentTabs from "../_components/EquipmentTabs";

export const dynamic = "force-dynamic";

interface SP { from?: string; to?: string; }

export default async function EquipmentReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await readSession();
  if (!hasPermission(session, "finance:equipment_profitability:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Equipment" title="Equipment Reports" />
        <CardShell title="No access"><Empty message="You don't have permission to view equipment profitability reports." /></CardShell>
      </div>
    );
  }
  const range = { from: sp.from ?? lastNDays(90).from, to: sp.to ?? lastNDays(90).to };
  const r = await equipmentReport(range);
  const t = r.totals;

  return (
    <div className="portal-page">
      <PageHeader kicker="Equipment" title="Equipment Reports" subtitle="Sales, cost, and profitability across equipment orders." />
      <EquipmentTabs active="reports" />

      <FilterBar>
        <FilterField label="From"><input type="date" name="from" defaultValue={range.from} className="portal-input" /></FilterField>
        <FilterField label="To"><input type="date" name="to" defaultValue={range.to} className="portal-input" /></FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/equipment/reports" className="portal-btn">Clear</Link>
      </FilterBar>

      <section className="portal-grid-4">
        <StatPill label="Orders (sales)" value={t.orders} />
        <StatPill label="Units sold" value={t.units} />
        <StatPill label="AM charge total" value={<span className="money-pos">{fmt$(t.amChargeTotal)}</span>} />
        <StatPill label="Company cost" value={<span className="money-neg">{fmt$(t.companyCostTotal)}</span>} />
        <StatPill label="Gross profit" value={fmt$(t.grossProfit)} />
        <StatPill label="Gross margin" value={`${t.grossMarginPct.toFixed(1)}%`} />
        <StatPill label="Credits posted" value={<span className="money-neg">{fmt$(r.returns.creditsPosted)}</span>} />
        <StatPill label="Delivered, not posted" value={r.deliveredNotPosted.length} />
      </section>

      <CardShell title="Sales by Area Manager" subtitle={`${r.byAreaManager.length} AM(s)`}>
        {r.byAreaManager.length === 0 ? <Empty message="No sales in this window." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead><tr><th>Area Manager</th><th className="right">Orders</th><th className="right">Units</th><th className="right">AM charge</th><th className="right">Company cost</th><th className="right">Gross profit</th><th className="right">Margin</th></tr></thead>
              <tbody>
                {r.byAreaManager.map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}</td><td className="right">{a.orders}</td><td className="right">{a.units}</td>
                    <td className="right money">{fmt$(a.amChargeTotal)}</td>
                    <td className="right money muted">{fmt$(a.companyCostTotal)}</td>
                    <td className="right money">{fmt$(a.grossProfit)}</td>
                    <td className="right small">{a.grossMarginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardShell>

      <CardShell title="Product profitability & frequency" subtitle="Most-ordered first">
        {r.topProducts.length === 0 ? <Empty message="No products sold in this window." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead><tr><th>Product</th><th>SKU</th><th className="right">Units</th><th className="right">AM charge</th><th className="right">Company cost</th><th className="right">Gross profit</th><th className="right">Margin</th></tr></thead>
              <tbody>
                {r.topProducts.map((p) => (
                  <tr key={p.productId}>
                    <td>{p.name}</td><td className="small mono">{p.sku}</td><td className="right">{p.units}</td>
                    <td className="right money">{fmt$(p.amCharge)}</td>
                    <td className="right money muted">{fmt$(p.companyCost)}</td>
                    <td className="right money">{fmt$(p.grossProfit)}</td>
                    <td className="right small">{p.grossMarginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardShell>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <CardShell title="Approved — not yet charged" subtitle={`${r.approvedNotCharged.length}`}>
          {r.approvedNotCharged.length === 0 ? <Empty message="Nothing outstanding." /> : (
            <table className="portal-table">
              <thead><tr><th>Order</th><th>AM</th><th className="right">Amount</th></tr></thead>
              <tbody>{r.approvedNotCharged.map((o) => (
                <tr key={o._id}><td className="mono small"><Link href={`/portal/equipment/orders/${o._id}`} style={{ color: "#818cf8", textDecoration: "none" }}>{o.orderNumber}</Link></td><td>{o.areaManagerName}</td><td className="right money">{fmt$(o.amChargeTotal)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </CardShell>
        <CardShell title="Delivered — not yet posted" subtitle={`${r.deliveredNotPosted.length}`}>
          {r.deliveredNotPosted.length === 0 ? <Empty message="Nothing outstanding." /> : (
            <table className="portal-table">
              <thead><tr><th>Order</th><th>AM</th><th className="right">Amount</th></tr></thead>
              <tbody>{r.deliveredNotPosted.map((o) => (
                <tr key={o._id}><td className="mono small"><Link href={`/portal/equipment/orders/${o._id}`} style={{ color: "#818cf8", textDecoration: "none" }}>{o.orderNumber}</Link></td><td>{o.areaManagerName}</td><td className="right money">{fmt$(o.amChargeTotal)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </CardShell>
      </div>

      <CardShell title="Sales by date">
        {r.byDate.length === 0 ? <Empty message="No sales in this window." /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead><tr><th>Date</th><th className="right">Orders</th><th className="right">AM charge</th></tr></thead>
              <tbody>{r.byDate.map((d) => (
                <tr key={d.date}><td className="small mono">{fmtDate(d.date)}</td><td className="right">{d.orders}</td><td className="right money">{fmt$(d.amChargeTotal)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </CardShell>
    </div>
  );
}
