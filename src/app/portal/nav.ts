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
  FiShield,
  FiUpload,
  FiLock,
  FiCpu,
  FiCheckSquare,
  FiShoppingCart,
  FiGrid,
} from "react-icons/fi";
import type { ComponentType } from "react";
import type { Permission } from "@/types/rbac";

export type FinanceModule = {
  href: string;
  label: string;
  section: string;
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  group: "overview" | "ai" | "work" | "field" | "money" | "people" | "tracking" | "system" | "admin" | "tools" | "me";
  /** Permission required to see this nav entry. Multiple = any-of. */
  requires: Permission | Permission[];
};

export const FINANCE_NAV: FinanceModule[] = [
  {
    href: "/portal/dashboard",
    label: "Executive Dashboard",
    section: "Overview",
    title: "Executive Dashboard",
    icon: FiPieChart,
    group: "overview",
    requires: "finance:dashboard:view",
  },
  // AI Workspace
  {
    href: "/portal/ai",
    label: "AI Workspace",
    section: "AI",
    title: "AI Workspace",
    icon: FiCpu,
    group: "ai",
    requires: "system:ai:view",
  },
  // Team task board
  {
    href: "/portal/tasks",
    label: "Task Board",
    section: "Team",
    title: "Task Board",
    icon: FiCheckSquare,
    group: "work",
    requires: "finance:tasks:view",
  },
  // Money in & out
  {
    href: "/portal/income",
    label: "Income",
    section: "Money",
    title: "Income",
    icon: FiTrendingUp,
    group: "money",
    requires: "finance:income:view",
  },
  {
    href: "/portal/expenses",
    label: "Expenses",
    section: "Money",
    title: "Expenses",
    icon: FiTrendingDown,
    group: "money",
    requires: "finance:expenses:view",
  },
  {
    href: "/portal/payouts",
    label: "Payouts",
    section: "Money",
    title: "Payouts",
    icon: FiDollarSign,
    group: "money",
    requires: "finance:payouts:view",
  },
  {
    href: "/portal/reports",
    label: "Balance Reports",
    section: "Money",
    title: "Balance Reports",
    icon: FiFileText,
    group: "money",
    requires: "finance:reports:view",
  },
  // People
  {
    href: "/portal/providers",
    label: "Providers",
    section: "People",
    title: "Providers",
    icon: FiBriefcase,
    group: "people",
    requires: "finance:providers:view",
  },
  {
    href: "/portal/area-managers",
    label: "Area Managers",
    section: "People",
    title: "Area Managers",
    icon: FiMapPin,
    group: "people",
    requires: "finance:area_managers:view",
  },
  {
    href: "/portal/technicians",
    label: "Technicians",
    section: "People",
    title: "Technicians",
    icon: FiUsers,
    group: "people",
    requires: "finance:technicians:view",
  },
  {
    href: "/portal/employees",
    label: "Employees & Positions",
    section: "People",
    title: "Employees & Positions",
    icon: FiUserCheck,
    group: "people",
    requires: "finance:employees:view",
  },
  // Tracking
  {
    href: "/portal/debts",
    label: "Debts & Balances",
    section: "Tracking",
    title: "Debts & Balances",
    icon: FiCreditCard,
    group: "tracking",
    requires: "finance:debts:view",
  },
  {
    href: "/portal/ledger",
    label: "Ledger",
    section: "Tracking",
    title: "Ledger",
    icon: FiArchive,
    group: "tracking",
    requires: "finance:area_managers:view",
  },
  {
    href: "/portal/disputes",
    label: "Disputes & Refunds",
    section: "Tracking",
    title: "Disputes & Refunds",
    icon: FiAlertTriangle,
    group: "tracking",
    requires: "finance:disputes:view",
  },
  {
    href: "/portal/equipment",
    label: "Equipment Finance",
    section: "Tracking",
    title: "Equipment Finance",
    icon: FiPackage,
    group: "tracking",
    requires: "finance:equipment:view",
  },
  {
    href: "/portal/equipment/orders",
    label: "Equipment Orders",
    section: "Tracking",
    title: "Equipment Orders",
    icon: FiShoppingCart,
    group: "tracking",
    requires: "finance:equipment_orders:view",
  },
  {
    href: "/portal/equipment/products",
    label: "Product Catalog",
    section: "Tracking",
    title: "Product Catalog",
    icon: FiGrid,
    group: "tracking",
    requires: "finance:equipment_products:view",
  },
  {
    href: "/portal/documents",
    label: "Reports & Documents",
    section: "Tracking",
    title: "Reports & Documents",
    icon: FiArchive,
    group: "tracking",
    requires: "finance:documents:view",
  },
  {
    href: "/portal/banking",
    label: "Banking",
    section: "System",
    title: "Banking & Reconciliation",
    icon: FiHome,
    group: "system",
    requires: "finance:banking:view",
  },
  {
    href: "/portal/settings",
    label: "Settings",
    section: "System",
    title: "Finance Settings",
    icon: FiSettings,
    group: "system",
    requires: "finance:settings:view",
  },
  // Admin
  {
    href: "/portal/admin/users",
    label: "Users & Roles",
    section: "Admin",
    title: "Users & Roles",
    icon: FiShield,
    group: "admin",
    requires: ["system:users:view", "system:roles:view"],
  },
  // Tools
  {
    href: "/portal/import",
    label: "CSV Import",
    section: "Tools",
    title: "CSV Import",
    icon: FiUpload,
    group: "tools",
    requires: ["finance:expenses:create", "finance:income:create"],
  },
  // My account
  {
    href: "/portal/me/security",
    label: "My Security (2FA)",
    section: "My account",
    title: "Security",
    icon: FiLock,
    group: "me",
    // Every authenticated user gets this — gate on a permission everyone has.
    // We use crm:jobs:view since every active role has at least one view perm
    // anyway. For more permissive access, swap to a literal "true" check.
    requires: ["crm:jobs:view", "finance:dashboard:view", "system:users:view"],
  },
];

export const FINANCE_GROUPS: Array<{ key: FinanceModule["group"]; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "ai", label: "AI" },
  { key: "work", label: "Team" },
  { key: "money", label: "Money" },
  { key: "people", label: "People" },
  { key: "tracking", label: "Tracking" },
  { key: "system", label: "System" },
  { key: "tools", label: "Tools" },
  { key: "admin", label: "Admin" },
  { key: "me", label: "My account" },
];

/** Filter the nav by the session's effective permissions. */
export function visibleNavFor(permissions: ReadonlyArray<Permission>): FinanceModule[] {
  const set = new Set(permissions);
  return FINANCE_NAV.filter((m) => {
    const required = Array.isArray(m.requires) ? m.requires : [m.requires];
    return required.some((p) => set.has(p));
  });
}

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

/** Which roles can access the portal at all.
 *  @deprecated Use permission checks instead. Kept for backwards-compatibility
 *  with callers that still pass a `type` string. */
export function userCanAccessPortal(type: string | undefined): boolean {
  return type === "admin" || type === "office" || type === "bookkeeper";
}

/** True if the session has at least one finance:* permission OR system access.
 *  (Field Service modules live in the CRM, not the portal, so CRM-only roles
 *  don't need portal access.) */
export function sessionCanAccessPortal(permissions: ReadonlyArray<Permission>): boolean {
  return permissions.some(
    (p) => p.startsWith("finance:") || p.startsWith("system:")
  );
}
