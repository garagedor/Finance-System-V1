'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FiUsers, FiShield } from 'react-icons/fi';

// Shared horizontal tab nav above the admin pages. Lives in
// `src/app/admin/_components/` (the leading underscore keeps it out of
// Next's app-router route table). Both /admin/users and /admin/roles
// render this as their sub-header so the section reads as one feature.
const TABS = [
    { href: '/admin/users', label: 'Users', icon: FiUsers,  match: (p: string) => p === '/admin/users' || p.startsWith('/admin/users/') },
    { href: '/admin/roles', label: 'Roles', icon: FiShield, match: (p: string) => p === '/admin/roles' || p.startsWith('/admin/roles/') },
];

export function AdminTabs() {
    const pathname = usePathname() || '';
    return (
        <div className="adm-tabs">
            {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = tab.match(pathname);
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={`adm-tab ${active ? 'adm-tab--active' : ''}`}
                    >
                        <Icon size={14} />
                        {tab.label}
                    </Link>
                );
            })}
        </div>
    );
}
