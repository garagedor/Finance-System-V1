"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "users", label: "Users", href: "/portal/admin/users" },
  { key: "roles", label: "Roles & Permissions", href: "/portal/admin/roles" },
  { key: "audit", label: "Audit log", href: "/portal/admin/audit" },
  { key: "notifications", label: "Notifications", href: "/portal/admin/notifications" },
];

export default function AdminTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="portal-tabs" style={{ marginBottom: 18 }}>
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`portal-tab ${active ? "portal-tab-active" : ""}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
