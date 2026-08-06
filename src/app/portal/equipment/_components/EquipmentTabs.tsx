import Link from "next/link";
import { readSession, hasPermission } from "@/lib/rbac";
import type { Permission } from "@/types/rbac";

// Single-portal sub-navigation. One "Equipment" item lives in the sidebar; this
// tab bar (shown on every equipment page) switches between the sections the user
// is allowed to see.
const TABS: Array<{ key: string; href: string; label: string; perm: Permission }> = [
  { key: "orders", href: "/portal/equipment/orders", label: "Orders", perm: "finance:equipment_orders:view" },
  { key: "products", href: "/portal/equipment/products", label: "Catalog", perm: "finance:equipment_products:view" },
  { key: "returns", href: "/portal/equipment/returns", label: "Returns", perm: "finance:equipment_orders:view" },
  { key: "reports", href: "/portal/equipment/reports", label: "Reports", perm: "finance:equipment_profitability:view" },
  { key: "finance", href: "/portal/equipment/finance", label: "Finance ledger", perm: "finance:equipment:view" },
];

export default async function EquipmentTabs({ active }: { active: string }) {
  const session = await readSession();
  const tabs = TABS.filter((t) => hasPermission(session, t.perm));
  if (tabs.length <= 1) return null;
  return (
    <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 10, marginBottom: 4 }}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`portal-btn ${t.key === active ? "portal-btn-primary" : "portal-btn-ghost"}`}
          style={{ fontSize: 13 }}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
