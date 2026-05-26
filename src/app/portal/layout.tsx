"use client";

import "./styles.css";
import { useAuth } from "@/components/AuthShell";
import { userCanAccessPortal } from "./nav";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  if (!userCanAccessPortal(user?.type)) {
    return (
      <div className="portal-page">
        <div className="portal-alert portal-alert-warn" style={{ maxWidth: 520 }}>
          <strong>Restricted.</strong> The Finance Portal is available to admin, office, and
          bookkeeper roles. Your role: {user?.type ?? "unknown"}.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
