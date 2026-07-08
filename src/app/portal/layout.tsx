"use client";

import "./styles.css";
import { useAuth } from "@/components/AuthShell";
import { sessionCanAccessPortal } from "./nav";
import CommandPalette from "./_components/CommandPalette";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  // Admin always passes (defensive). Otherwise: needs at least one finance:*
  // or system:* permission. The user object is hydrated from /api/login so
  // permissions[] is populated immediately after sign-in.
  const allowed =
    user?.type === "admin" || sessionCanAccessPortal(user?.permissions ?? []);

  if (!allowed) {
    return (
      <div className="portal-page">
        <div className="portal-alert portal-alert-warn" style={{ maxWidth: 520 }}>
          <strong>Restricted.</strong> No finance permissions granted to your account.
          Ask an administrator to assign a role with finance access.
          {user?.type && <div className="muted small" style={{ marginTop: 6 }}>Type: {user.type}</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <CommandPalette />
    </>
  );
}
