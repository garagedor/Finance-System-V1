// Sidebar configuration for the Finance Portal.
// The 15 modules from product spec — order = sidebar order.
//
// Each item has: href, label, section (kicker shown above the label in topbar),
// title (page title in topbar), and a brief one-line description.

import {
  FiPieChart,
  FiTrendingUp,
  FiTrendingDown,
  FiDollarSign,
  FiFileText,
  FiBriefcase,
  FiMapPin,
  FiUsers,
  FiUserCheck,
  FiCreditCard,
  FiAlertTriangle,
  FiPackage,
  FiArchive,
  FiHome,
  FiSettings,
} from "react-icons/fi";
import type { ComponentType } from "react";

export type FinanceModule = {
  href: string;
  label: string;
  section: string;
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  group: "overview" | "money" | "people" | "tracking" | "system";
};

export const FINANCE_NAV: FinanceModule[] = [
  {
    href: "/portal/dashboard",
    label: "Executive Dashboard",
    section: "Overview",
    title: "Executive Dashboard",
    icon: FiPieChart,
    group: "overview",
  },
  // Money in & out
  {
    href: "/portal/income",
    label: "Income",
    section: "Money",
    title: "Income",
    icon: FiTrendingUp,
    group: "money",
  },
  {
    href: "/portal/expenses",
    label: "Expenses",
    section: "Money",
    title: "Expenses",
    icon: FiTrendingDown,
    group: "money",
  },
  {
    href: "/portal/payouts",
    label: "Payouts",
    section: "Money",
    title: "Payouts",
    icon: FiDollarSign,
    group: "money",
  },
  {
    href: "/portal/reports",
    label: "Balance Reports",
    section: "Money",
    title: "Balance Reports",
    icon: FiFileText,
    group: "money",
  },
  // People
  {
    href: "/portal/providers",
    label: "Providers",
    section: "People",
    title: "Providers",
    icon: FiBriefcase,
    group: "people",
  },
  {
    href: "/portal/area-managers",
    label: "Area Managers",
    section: "People",
    title: "Area Managers",
    icon: FiMapPin,
    group: "people",
  },
  {
    href: "/portal/technicians",
    label: "Technicians",
    section: "People",
    title: "Technicians",
    icon: FiUsers,
    group: "people",
  },
  {
    href: "/portal/employees",
    label: "Employees & Positions",
    section: "People",
    title: "Employees & Positions",
    icon: FiUserCheck,
    group: "people",
  },
  // Tracking
  {
    href: "/portal/debts",
    label: "Debts & Balances",
    section: "Tracking",
    title: "Debts & Balances",
    icon: FiCreditCard,
    group: "tracking",
  },
  {
    href: "/portal/disputes",
    label: "Disputes & Refunds",
    section: "Tracking",
    title: "Disputes & Refunds",
    icon: FiAlertTriangle,
    group: "tracking",
  },
  {
    href: "/portal/equipment",
    label: "Equipment Finance",
    section: "Tracking",
    title: "Equipment Finance",
    icon: FiPackage,
    group: "tracking",
  },
  {
    href: "/portal/documents",
    label: "Reports & Documents",
    section: "Tracking",
    title: "Reports & Documents",
    icon: FiArchive,
    group: "tracking",
  },
  {
    href: "/portal/banking",
    label: "Banking",
    section: "System",
    title: "Banking & Reconciliation",
    icon: FiHome,
    group: "system",
  },
  {
    href: "/portal/settings",
    label: "Settings",
    section: "System",
    title: "Finance Settings",
    icon: FiSettings,
    group: "system",
  },
];

export const FINANCE_GROUPS: Array<{ key: FinanceModule["group"]; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "money", label: "Money" },
  { key: "people", label: "People" },
  { key: "tracking", label: "Tracking" },
  { key: "system", label: "System" },
];

/** True when a path is anywhere under the finance portal. */
export function isPortalPath(pathname: string | null | undefined): boolean {
  return !!pathname && pathname.startsWith("/portal");
}

/** Find the module config that matches the current path (longest-prefix). */
export function findActiveModule(pathname: string | null | undefined): FinanceModule | null {
  if (!pathname) return null;
  let match: FinanceModule | null = null;
  for (const m of FINANCE_NAV) {
    if (pathname === m.href || pathname.startsWith(m.href + "/")) {
      if (!match || m.href.length > match.href.length) match = m;
    }
  }
  return match;
}

/** Which roles can access the portal at all. */
export function userCanAccessPortal(type: string | undefined): boolean {
  return type === "admin" || type === "office" || type === "bookkeeper";
}
