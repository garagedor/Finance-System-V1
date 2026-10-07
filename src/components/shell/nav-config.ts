/* ═══════════════════════════════════════════════════════════════════════════
   Ecosystem navigation — business categories, not an admin menu.

   The Finance Portal already carries grouped, permission-aware navigation in
   src/app/portal/nav.ts; that stays the source of truth and is re-grouped here
   into business categories rather than duplicated. CRM's navigation lived as a
   flat array in the root layout and is given the same treatment.

   SCOPE: presentation metadata only. Permissions referenced here are the ones
   the existing RBAC catalog already issues — nothing new is granted.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { ComponentType } from 'react';
import {
  FiGrid, FiCpu, FiBarChart2, FiDollarSign, FiFileText, FiCreditCard,
  FiCheckSquare, FiHome, FiUsers, FiTrendingUp, FiTrendingDown, FiSend,
  FiBriefcase, FiMapPin, FiPackage, FiArchive, FiSettings, FiShield,
  FiUpload, FiLock, FiPieChart, FiTruck, FiClipboard, FiBox, FiLayers,
  FiAlertTriangle,
} from 'react-icons/fi';
import type { PortalKey } from '@/config/portals';
import { WAREHOUSE_PERMISSIONS } from '@/types/rbac';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /**
   * Suppress the admin shortcut below for this item. Access must be held, not
   * implied by being an administrator — the Warehouse rule.
   */
  noAdminBypass?: boolean;
  /** Any one of these permissions reveals the item. Empty = always visible. */
  requires?: string[];
  /** Not built yet — rendered disabled so the shape is legible. */
  soon?: boolean;
}

export interface NavGroup {
  /** Business category, not a system area. */
  label: string;
  items: NavItem[];
}

/* ── CRM ──────────────────────────────────────────────────────────────────
   Was a flat list of 12 links in the root layout. Grouped by what the work
   actually is: the day's operations, then the numbers, then verification.   */
export const CRM_NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/crm', label: 'Dashboard', icon: FiHome, requires: ['crm:home:view'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/tables', label: 'Jobs', icon: FiGrid, requires: ['crm:jobs:view'] },
      { href: '/tables-ai', label: 'Jobs (AI mirror)', icon: FiCpu, requires: ['crm:jobs:view'] },
      { href: '/tech', label: 'Technician view', icon: FiUsers, requires: ['crm:tech_self:view'] },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { href: '/stats', label: 'Statistics', icon: FiBarChart2, requires: ['crm:stats:view'] },
      { href: '/balance-report', label: 'Balance report', icon: FiDollarSign, requires: ['crm:balance_report:view'] },
      { href: '/report', label: 'Provider report', icon: FiFileText, requires: ['crm:jobs:view'] },
      { href: '/payment-method-report', label: 'Payment methods', icon: FiCreditCard, requires: ['crm:payment_method_report:view'] },
    ],
  },
  {
    label: 'Verification',
    items: [
      { href: '/verify-reports', label: 'Weekly reports', icon: FiCheckSquare, requires: ['crm:verify_reports:view'] },
    ],
  },  {
    label: 'Administration',
    items: [
      // Lost its nav entry when the flat layout.tsx list was replaced.
      // Gated on the permission rather than the old adminOnly flag.
      { href: '/admin/users', label: 'Users & roles', icon: FiShield, requires: ['system:users:view'] },
      // /finance (legacy) is deliberately NOT listed. The route still exists
      // and stays reachable by direct URL for compatibility, but the Finance
      // portal at /portal/dashboard is the user-facing surface. Owner
      // decision, 2026-10-07 — do not re-add without an explicit call.
    ],
  },
  {
    label: 'Warehouse',
    items: [
      // The old flat nav carried this link; it is restored with the locked
      // rule attached — canonical membership of the twenty, and no admin
      // shortcut, so an administrator holding none of them does not see it.
      {
        href: '/warehouse',
        label: 'Warehouse',
        icon: FiPackage,
        requires: [...WAREHOUSE_PERMISSIONS],
        noAdminBypass: true,
      },
    ],
  },

];

/* ── Finance ──────────────────────────────────────────────────────────────
   Re-grouped from the portal's own eleven groups into five business
   categories. Every href and permission is unchanged.                       */
export const FIN_NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/portal/dashboard', label: 'Dashboard', icon: FiPieChart, requires: ['finance:dashboard:view'] },
      { href: '/portal/ai', label: 'AI Workspace', icon: FiCpu, requires: ['system:ai:view'] },
      { href: '/portal/tasks', label: 'Task board', icon: FiCheckSquare, requires: ['finance:tasks:view'] },
    ],
  },
  {
    label: 'Money in & out',
    items: [
      { href: '/portal/income', label: 'Income', icon: FiTrendingUp, requires: ['finance:income:view'] },
      { href: '/portal/expenses', label: 'Expenses', icon: FiTrendingDown, requires: ['finance:expenses:view'] },
      { href: '/portal/payouts', label: 'Payouts', icon: FiSend, requires: ['finance:payouts:view'] },
      { href: '/portal/banking', label: 'Banking', icon: FiCreditCard, requires: ['finance:banking:view'] },
    ],
  },
  {
    label: 'Balances & claims',
    items: [
      // portal/nav.ts gates the Ledger on finance:area_managers:view. Listing
      // only finance:debts:view hid it from anyone holding the first and not
      // the second. Both are listed so no one loses the entry.
      { href: '/portal/ledger', label: 'Ledgers', icon: FiArchive, requires: ['finance:area_managers:view', 'finance:debts:view'] },
      { href: '/portal/debts', label: 'Debts', icon: FiDollarSign, requires: ['finance:debts:view'] },
      // The inbox REPLACED /portal/disputes as the primary screen on 2026-10-05.
      // The shell nav was written before that and still pointed the headline
      // label at the old page, so every recent change — the unified inbox, the
      // filter bar, Posted/Ignored tabs, partial refunds, the post-to-ledger
      // picker — was invisible while living one route away. portal/nav.ts, the
      // source of truth, lists only the inbox.
      { href: '/portal/disputes/inbox', label: 'Disputes & refunds', icon: FiAlertTriangle, requires: ['finance:disputes:view'] },
      { href: '/portal/disputes/scanpay', label: 'ScanPay disputes', icon: FiShield, requires: ['finance:disputes:view'] },
      // Equipment is one entry whose in-page tabs cover orders / catalog /
      // returns / reports / finance. portal/nav.ts reveals it on ANY of four
      // permissions; listing one hid it from order-, catalog- and
      // profitability-only users.
      { href: '/portal/equipment', label: 'Equipment', icon: FiPackage,
        requires: ['finance:equipment:view', 'finance:equipment_orders:view',
                   'finance:equipment_products:view', 'finance:equipment_profitability:view'] },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { href: '/portal/reports', label: 'Balance reports', icon: FiFileText, requires: ['finance:reports:view'] },
      { href: '/portal/finance-report', label: 'Financial report', icon: FiFileText, requires: ['finance:reports:view'] },
      { href: '/portal/finance-report/custom', label: 'Custom report', icon: FiFileText, requires: ['finance:reports:view'] },
      { href: '/portal/documents', label: 'Documents', icon: FiClipboard, requires: ['finance:documents:view'] },
    ],
  },
  {
    label: 'People & partners',
    items: [
      { href: '/portal/area-managers', label: 'Area managers', icon: FiMapPin, requires: ['finance:area_managers:view'] },
      { href: '/portal/technicians', label: 'Technicians', icon: FiUsers, requires: ['finance:technicians:view'] },
      { href: '/portal/employees', label: 'Employees', icon: FiBriefcase, requires: ['finance:employees:view'] },
      { href: '/portal/providers', label: 'Providers', icon: FiLayers, requires: ['finance:providers:view'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/portal/admin/users', label: 'Users & roles', icon: FiShield, requires: ['system:users:view', 'system:roles:view'] },
      { href: '/portal/settings', label: 'Settings', icon: FiSettings, requires: ['finance:settings:view'] },
      // CSV import writes expenses and income, so portal/nav.ts gates it on
      // those create permissions. system:users:view was the wrong key in both
      // directions: it hid the tool from bookkeepers and offered it to user
      // administrators who cannot import.
      { href: '/portal/import', label: 'CSV import', icon: FiUpload, requires: ['finance:expenses:create', 'finance:income:create'] },
      { href: '/portal/me/security', label: 'My security', icon: FiLock },
    ],
  },
];

/* ── Warehouse — concept only, nothing built ──────────────────────────── */
export const WHS_NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/warehouse', label: 'Dashboard', icon: FiHome, soon: true }],
  },
  {
    label: 'Inventory',
    items: [
      { href: '/warehouse/products', label: 'Products', icon: FiBox, soon: true },
      { href: '/warehouse/stock', label: 'Current stock', icon: FiLayers, soon: true },
      { href: '/warehouse/locations', label: 'Locations', icon: FiMapPin, soon: true },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      { href: '/warehouse/orders', label: 'Purchase orders', icon: FiClipboard, soon: true },
      { href: '/warehouse/suppliers', label: 'Suppliers', icon: FiBriefcase, soon: true },
    ],
  },
  {
    label: 'Logistics',
    items: [
      { href: '/warehouse/shipments', label: 'Shipments', icon: FiTruck, soon: true },
      { href: '/warehouse/receiving', label: 'Receiving', icon: FiPackage, soon: true },
    ],
  },
];

export const NAV_BY_PORTAL: Record<PortalKey, NavGroup[]> = {
  crm: CRM_NAV,
  fin: FIN_NAV,
  whs: WHS_NAV,
};

/** Which portal a path belongs to. Defaults to CRM, which owns the root. */
export function portalForPath(pathname: string | null): PortalKey {
  if (!pathname) return 'crm';
  if (pathname.startsWith('/portal')) return 'fin';
  if (pathname.startsWith('/warehouse')) return 'whs';
  return 'crm';
}

export const PORTAL_LABEL: Record<PortalKey, string> = {
  crm: 'CRM',
  fin: 'Finance Portal',
  whs: 'Warehouse',
};

/** Longest matching href wins, so /portal/ledger/[id] highlights Ledgers. */
export function activeHref(groups: NavGroup[], pathname: string | null): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const g of groups) {
    for (const it of g.items) {
      const hit = it.href === '/' ? pathname === '/' : pathname.startsWith(it.href);
      if (hit && (!best || it.href.length > best.length)) best = it.href;
    }
  }
  return best;
}

/** Hide what the session cannot reach. Admin sees everything. */
export function visibleGroups(
  groups: NavGroup[],
  permissions: readonly string[] | undefined,
  isAdmin: boolean,
): NavGroup[] {
  const perms = new Set(permissions ?? []);
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        if (!it.requires) return true;
        const held = it.requires.some((p) => perms.has(p));
        // The admin shortcut is deliberately not universal: an item marked
        // noAdminBypass must be genuinely held.
        return it.noAdminBypass ? held : isAdmin || held;
      }),
    }))
    .filter((g) => g.items.length > 0);
}
