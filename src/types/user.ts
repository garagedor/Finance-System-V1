import type { Permission } from "./rbac";

export type UserType = "admin" | "office" | "location-manager" | "simple" | "bookkeeper";

export type User = {
    _id?: string;
    name: string;
    password: string;
    /**
     * Legacy role string. Preserved for backwards-compatibility while the
     * RBAC migration runs. New code should prefer `role_id` + RBAC helpers.
     */
    type: UserType;
    /** Foreign key into the `finance_role` collection. Populated by the
     *  RBAC migration; missing means "fall back to `type` lookup". */
    role_id?: string;
    /** Defaults to true. Set false to disable login without deleting. */
    active?: boolean;
    /** Extra permission keys granted directly to this user, on top of role. */
    extra_permissions?: Permission[];
    /** Permission keys explicitly denied for this user (overrides role grant). */
    denied_permissions?: Permission[];
    /** Audit fields. */
    created_at?: string;
    updated_at?: string;
    last_login_at?: string;
    /** Optional contact email for notifications. */
    email?: string;
    /** Per-kind opt-in/out for transactional emails. `undefined` = use default. */
    notification_prefs?: Record<string, boolean>;
    /** TOTP shared secret. Stored base32-encoded. Set only after enrollment. */
    totp_secret?: string;
    /** True once the user has confirmed a TOTP code (proof they enrolled). */
    totp_enabled?: boolean;
    /** Single-use backup codes (bcrypt-hashed). Consumed on use. */
    totp_backup_codes?: string[];
    /** Last successful TOTP timestep — prevents replay within the window. */
    totp_last_step?: number;
};

export type AuthUser = Omit<User, 'password'> & {
    token?: string;
    /** Effective permissions resolved at login time (role + extras − denied). */
    permissions?: Permission[];
};
