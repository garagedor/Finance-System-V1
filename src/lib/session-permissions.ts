// Compact encoding of a session's permissions inside the JWT cookie.
//
// Browsers silently DROP a cookie whose name + value exceeds 4096 bytes. With
// the full catalog (126 keys since the Warehouse module) a plain array made the
// session cookie ~4.5KB: login succeeded, the browser discarded the cookie, the
// first API call returned 401, and the user landed back on the login page.
//
// Keys share their "area:module" prefix, so they are written grouped:
//
//   ["crm:jobs:view","crm:jobs:edit","wh:catalog:view"]
//     → "crm:jobs=view,edit;wh:catalog=view"
//
// Exact and order-independent: decoding yields the same set that was encoded,
// whatever the catalog looks like at either end. No index or bitmap, so a
// permission added or removed later can never shift what an old token means.
//
// Pure — no server imports — so it is unit-testable on its own.

/** Encode a permission list. Inverse of unpackPermissions. */
export function packPermissions(perms: readonly string[]): string {
  const groups = new Map<string, string[]>();
  for (const p of new Set(perms)) {
    const i = p.lastIndexOf(":");
    // A key without an action segment cannot be grouped; keep it whole under
    // an empty prefix so it round-trips unchanged.
    const prefix = i > 0 ? p.slice(0, i) : "";
    const action = i > 0 ? p.slice(i + 1) : p;
    const list = groups.get(prefix) ?? [];
    list.push(action);
    groups.set(prefix, list);
  }
  return [...groups].map(([prefix, actions]) => `${prefix}=${actions.join(",")}`).join(";");
}

/** Decode a packed string back to the permission list. */
export function unpackPermissions(packed: string): string[] {
  const out: string[] = [];
  for (const group of packed.split(";")) {
    if (!group) continue;
    const eq = group.indexOf("=");
    if (eq < 0) continue;
    const prefix = group.slice(0, eq);
    for (const action of group.slice(eq + 1).split(",")) {
      if (!action) continue;
      out.push(prefix ? `${prefix}:${action}` : action);
    }
  }
  return out;
}

/**
 * Leave the permissions out of the token entirely past this many packed
 * bytes. The session reader then resolves them from the database, which is
 * the path tokens without permissions have always taken. Keeps the cookie
 * well under 4096 even if the catalog keeps growing.
 */
export const MAX_PACKED_PERMISSION_BYTES = 2400;
