/* ═══════════════════════════════════════════════════════════════════════════
   Portal registry — the single source of truth for the ecosystem's three
   portals. Shared by the login access-granted sequence and the Main Gateway
   so the two can never disagree about what a user can reach.

   SCOPE: presentation metadata only. No permission is granted here — these
   are the prefixes the existing RBAC catalog already issues, matched against
   whatever the session actually carries.
   ═══════════════════════════════════════════════════════════════════════════ */

export type PortalKey = 'crm' | 'fin' | 'whs';

export interface PortalDef {
  key: PortalKey;
  name: string;
  /** Short plain-language line. No jargon — a new employee should understand it. */
  blurb: string;
  href: string;
  /** Holding ANY permission with one of these prefixes grants the portal. */
  anyOf: string[];
  /** Not yet built. Visible so the ecosystem's shape is legible from day one. */
  soon?: boolean;
  /** Labels for the three live signals on the gateway card. */
  signals: [string, string, string];
}

export const PORTALS: PortalDef[] = [
  {
    key: 'crm',
    name: 'CRM',
    blurb: 'Dispatch, job records, technicians and customer history.',
    href: '/',
    anyOf: ['crm:'],
    signals: ['Jobs today', 'Active techs', 'Open issues'],
  },
  {
    key: 'fin',
    name: 'Finance Portal',
    blurb: 'Ledgers, balances, payouts, disputes and reporting.',
    href: '/portal/dashboard',
    anyOf: ['finance:'],
    signals: ['To settle', 'Open items', 'Unreconciled'],
  },
  {
    key: 'whs',
    name: 'Warehouse',
    blurb: 'Purchasing, containers, receiving and inventory in Miami.',
    href: '/warehouse',
    anyOf: ['warehouse:'],
    soon: true,
    signals: ['In transit', 'Containers due', 'Receiving'],
  },
];

/** Portals this session can actually open. Admins pass everything not `soon`. */
export function grantedPortals(
  permissions: readonly string[] | undefined,
  userType?: string,
): PortalKey[] {
  const perms = permissions ?? [];
  const isAdmin = userType === 'admin';
  return PORTALS.filter(
    (p) => !p.soon && (isAdmin || perms.some((k) => p.anyOf.some((pre) => k.startsWith(pre)))),
  ).map((p) => p.key);
}

/**
 * Where to send someone straight after sign-in.
 *
 *   2–3 portals → the gateway, which is the only screen showing cross-portal
 *                 attention items and the business-wide summary.
 *   exactly 1   → that portal. A gateway with one open card and two locked
 *                 ones is a worse first impression than arriving at work;
 *                 /home stays reachable from the ecosystem mark.
 *   none        → the gateway, which renders a proper "no access yet" state
 *                 rather than an empty dashboard.
 */
export function postLoginRoute(
  permissions: readonly string[] | undefined,
  userType?: string,
): string {
  const granted = grantedPortals(permissions, userType);
  if (granted.length === 1) {
    return PORTALS.find((p) => p.key === granted[0])!.href;
  }
  return '/home';
}
