// Shared building blocks for finance portal list pages.

import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="portal-header">
      <div className="portal-header-left">
        {kicker && <span className="portal-kicker">{kicker}</span>}
        <h1 className="portal-title">{title}</h1>
        {subtitle && <p className="portal-subtitle">{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </header>
  );
}

export function StatPill({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="portal-kpi" style={{ padding: "12px 14px" }}>
      <div className="portal-kpi-label">{label}</div>
      <div className="portal-kpi-value" style={{ fontSize: 18 }}>{value}</div>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <form className="portal-toolbar">{children}</form>;
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="portal-label">{label}</span>
      {children}
    </label>
  );
}

export function CardShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="portal-card-head">
        <div>
          <div className="portal-card-head-title">{title}</div>
          {subtitle && <div className="portal-card-head-sub">{subtitle}</div>}
        </div>
        {actions && <div style={{ display: "flex", gap: 6 }}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Empty({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="portal-empty">
      {message}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="muted">—</span>;
  const cls =
    status === "paid"     ? "pill-paid" :
    status === "unpaid"   ? "pill-unpaid" :
    status === "pending"  ? "pill-pending" :
    status === "open"     ? "pill-open" :
    status === "settled"  ? "pill-paid" :
    status === "deducted" ? "pill-paid" :
    status === "won"      ? "pill-paid" :
    status === "lost"     ? "pill-unpaid" :
    status === "partial"  ? "pill-pending" :
    "pill-draft";
  return <span className={`pill ${cls}`}>{status}</span>;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{ fontSize: 12, color: "#818cf8", textDecoration: "none" }}
    >
      ← {label}
    </Link>
  );
}
