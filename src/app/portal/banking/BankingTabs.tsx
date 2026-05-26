import Link from "next/link";

const TABS: Array<{ key: string; label: string; href: string }> = [
  { key: "connections", label: "Connections",     href: "/portal/banking/connections" },
  { key: "synced",      label: "Bank txns",       href: "/portal/banking/synced" },
  { key: "reconcile",   label: "Reconciliation",  href: "/portal/banking/reconcile" },
  { key: "settlements", label: "Settlements",     href: "/portal/banking/settlements" },
];

export default function BankingTabs({ active }: { active: string }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`portal-range-pill ${active === t.key ? "active" : ""}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
