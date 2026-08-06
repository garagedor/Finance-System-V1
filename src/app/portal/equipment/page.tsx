import { redirect } from "next/navigation";
import { readSession, hasPermission } from "@/lib/rbac";
import type { Permission } from "@/types/rbac";

export const dynamic = "force-dynamic";

// The Equipment portal is one sidebar item. Landing here routes the user to the
// first section they're allowed to see (tabs handle the rest).
const LANDINGS: Array<[Permission, string]> = [
  ["finance:equipment_orders:view", "/portal/equipment/orders"],
  ["finance:equipment_products:view", "/portal/equipment/products"],
  ["finance:equipment_profitability:view", "/portal/equipment/reports"],
  ["finance:equipment:view", "/portal/equipment/finance"],
];

export default async function EquipmentIndex() {
  const session = await readSession();
  for (const [perm, href] of LANDINGS) {
    if (hasPermission(session, perm)) redirect(href);
  }
  // No equipment access — send to orders, which renders a friendly no-access card.
  redirect("/portal/equipment/orders");
}
