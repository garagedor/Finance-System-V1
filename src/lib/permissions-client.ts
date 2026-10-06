/**
 * Permission checks for client components.
 *
 * `lib/rbac.ts` is server-only — it reads cookies and the database — so a
 * client component cannot import it. This is the same question asked of the
 * session object the browser already holds, so that a page, its navigation and
 * its API all gate on the same permission string rather than three different
 * ideas of who may be there.
 *
 * It is not a security boundary. The API is. A client check decides what to
 * render; the server decides what is allowed.
 */

export interface PermissionBearer {
  permissions?: readonly string[];
}

/** Whether the signed-in session carries a permission. */
export function clientHasPermission(
  user: PermissionBearer | null | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  return (user.permissions ?? []).includes(permission);
}
