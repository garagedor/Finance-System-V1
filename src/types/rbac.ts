// Role-Based Access Control (RBAC) types + permission catalog.
//
// The PERMISSION_CATALOG is the source of truth for every permission the
// codebase recognises. New permissions are added here first; the roles UI
// renders straight from this catalog so any new entry shows up automatically
// in the permission matrix.

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "dispute"
  | "export"
  | "manage"
  | "run"
  | "connect"
  | "disconnect"
  | "sync"
  | "reconcile"
  | "reset_password";

/** A permission identifier of the form `module:section:action`. */
export type Permission = string;

export interface PermissionDef {
  /** Stable key — never change once shipped (would break stored role data). */
  key: Permission;
  /** Top-level grouping shown as a section header in the matrix UI. */
  module: "system" | "crm" | "finance";
  /** Sub-grouping inside a module. Same `section` rows are clustered. */
  section: string;
  /** The action verb. */
  action: PermissionAction;
  /** Short human-readable label for the matrix UI. */
  label: string;
  /** Optional one-line tooltip explanation. */
  description?: string;
}

/** Convenience builder so the catalog list stays readable. */
function p(
  module: PermissionDef["module"],
  section: string,
  action: PermissionAction,
  label: string,
  description?: string
): PermissionDef {
  return { key: `${module}:${section}:${action}`, module, section, action, label, description };
}

/** Every permission the application recognises. Order = display order. */
export const PERMISSION_CATALOG: ReadonlyArray<PermissionDef> = [
  // ── System ────────────────────────────────────────────────────────────
  p("system", "users", "view", "View users"),
  p("system", "users", "create", "Create users"),
  p("system", "users", "edit", "Edit users"),
  p("system", "users", "delete", "Delete users"),
  p("system", "users", "reset_password", "Reset passwords"),
  p("system", "roles", "view", "View roles"),
  p("system", "roles", "create", "Create roles"),
  p("system", "roles", "edit", "Edit roles & permissions"),
  p("system", "roles", "delete", "Delete custom roles"),
  p("system", "integrations", "view", "View integrations (Plaid, etc.)"),
  p("system", "integrations", "edit", "Configure integrations"),

  // ── CRM (legacy main app) ─────────────────────────────────────────────
  p("crm", "home", "view", "CRM home dashboard"),
  p("crm", "jobs", "view", "View jobs"),
  p("crm", "jobs", "create", "Create jobs"),
  p("crm", "jobs", "edit", "Edit jobs"),
  p("crm", "jobs", "delete", "Delete jobs"),
  p("crm", "jobs", "approve", "Approve jobs"),
  p("crm", "jobs", "dispute", "Open job disputes"),
  p("crm", "customers", "view", "View customers"),
  p("crm", "customers", "edit", "Edit customers"),
  p("crm", "locations", "view", "View locations / areas"),
  p("crm", "locations", "edit", "Edit locations / areas"),
  p("crm", "technicians", "view", "View technicians (CRM)"),
  p("crm", "technicians", "edit", "Edit technicians (CRM)"),
  p("crm", "stats", "view", "View statistics page"),
  p("crm", "balance_report", "view", "View balance report"),
  p("crm", "balance_report", "export", "Export balance report"),
  p("crm", "payment_method_report", "view", "View payment-method report"),
  p("crm", "verify_reports", "view", "View weekly verify-reports"),
  p("crm", "verify_reports", "edit", "Edit weekly verify-reports / mappings"),
  p("crm", "tech_self", "view", "Technician self-view"),

  // ── Finance Portal ────────────────────────────────────────────────────
  p("finance", "dashboard", "view", "Executive dashboard"),

  p("finance", "income", "view", "View income"),
  p("finance", "income", "create", "Create income"),
  p("finance", "income", "edit", "Edit income"),
  p("finance", "income", "delete", "Delete income"),

  p("finance", "expenses", "view", "View expenses"),
  p("finance", "expenses", "create", "Create expenses"),
  p("finance", "expenses", "edit", "Edit expenses"),
  p("finance", "expenses", "delete", "Delete expenses"),

  p("finance", "recurring_expenses", "view", "View recurring expenses"),
  p("finance", "recurring_expenses", "create", "Create recurring expenses"),
  p("finance", "recurring_expenses", "edit", "Edit recurring expenses"),
  p("finance", "recurring_expenses", "delete", "Delete recurring expenses"),
  p("finance", "recurring_expenses", "run", "Run recurring expense generator"),

  p("finance", "payouts", "view", "View payouts"),
  p("finance", "payouts", "create", "Create payouts"),
  p("finance", "payouts", "edit", "Edit payouts"),
  p("finance", "payouts", "delete", "Delete payouts"),

  p("finance", "reports", "view", "View saved reports"),
  p("finance", "reports", "create", "Generate reports"),
  p("finance", "reports", "edit", "Edit reports"),
  p("finance", "reports", "delete", "Delete reports"),

  p("finance", "providers", "view", "View providers"),
  p("finance", "providers", "edit", "Edit providers"),
  p("finance", "area_managers", "view", "View area managers"),
  p("finance", "area_managers", "create", "Create area managers"),
  p("finance", "area_managers", "edit", "Edit area managers"),
  p("finance", "area_managers", "delete", "Delete area managers"),
  p("finance", "technicians", "view", "View technicians (finance)"),
  p("finance", "technicians", "edit", "Edit technicians (finance)"),
  p("finance", "employees", "view", "View employees & positions"),
  p("finance", "employees", "edit", "Edit employees & positions"),

  p("finance", "debts", "view", "View debts & balances"),
  p("finance", "debts", "edit", "Edit debts"),

  p("finance", "disputes", "view", "View disputes & refunds"),
  p("finance", "disputes", "edit", "Edit disputes & refunds"),

  p("finance", "equipment", "view", "View equipment finance"),
  p("finance", "equipment", "edit", "Edit equipment finance"),

  p("finance", "documents", "view", "View reports & documents"),
  p("finance", "documents", "create", "Create documents"),
  p("finance", "documents", "edit", "Edit documents"),
  p("finance", "documents", "delete", "Delete documents"),

  p("finance", "banking", "view", "View bank connections & transactions"),
  p("finance", "banking", "connect", "Connect new banks"),
  p("finance", "banking", "disconnect", "Disconnect banks"),
  p("finance", "banking", "sync", "Sync bank transactions"),
  p("finance", "banking", "reconcile", "Match bank txns to CRM"),

  p("finance", "settings", "view", "View finance settings"),
  p("finance", "settings", "edit", "Edit finance settings"),
] as const;

/** Map from key → definition, for O(1) lookup. */
export const PERMISSION_BY_KEY: Readonly<Record<Permission, PermissionDef>> =
  Object.fromEntries(PERMISSION_CATALOG.map((p) => [p.key, p]));

/** All recognised permission keys. */
export const ALL_PERMISSIONS: ReadonlyArray<Permission> = PERMISSION_CATALOG.map((p) => p.key);

/** Pretty label for a module (used as section header in the matrix). */
export const MODULE_LABEL: Record<PermissionDef["module"], string> = {
  system: "System",
  crm: "CRM",
  finance: "Finance Portal",
};

// ── Records stored in MongoDB ───────────────────────────────────────────────

export interface RoleRecord {
  _id: string; // newId("role")
  /** Display name. Editable for system roles too, but key stays stable. */
  name: string;
  /** Stable identifier for system roles (e.g. "admin"). Never changes. */
  key?: string;
  description?: string;
  permissions: Permission[];
  /** System roles are seeded by the app; users can edit perms but not delete. */
  is_system: boolean;
  created_at: string;
  created_by?: string;
  updated_at: string;
  updated_by?: string;
}

/** Kinds of things the audit log can track. */
export type AuditKind =
  | "role"
  | "user"
  | "expense"
  | "income"
  | "payout"
  | "refund"
  | "debt"
  | "dispute"
  | "settlement"
  | "recurring_expense"
  | "bank_txn"
  | "recon_match"
  | "report"
  | "auth";

/** Audit row written on every mutation that touches money or access. */
export interface AuditRecord {
  _id: string;
  target_kind: AuditKind;
  /** _id of the affected document (string form). */
  target_id: string;
  /** Snapshot of the relevant fields before (null on create). */
  before: unknown;
  /** Snapshot of the relevant fields after (null on delete). */
  after: unknown;
  /** One-line human summary, e.g. "Created expense Office Rent $1,200". */
  summary: string;
  /** Optional category for filtering — usually mirrors `target_kind` but
   *  e.g. an auth event might have action="login_failed". */
  action?: string;
  /** Username of the actor. */
  changed_by: string;
  changed_at: string;
}

/** @deprecated alias kept so the RBAC code reads naturally. */
export type RoleAuditRecord = AuditRecord;

/** Stable keys of seeded system roles. Used to find them on startup. */
export const SYSTEM_ROLE_KEYS = {
  admin: "admin",
  office: "office",
  bookkeeper: "bookkeeper",
  locationManager: "location-manager",
  simple: "simple",
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[keyof typeof SYSTEM_ROLE_KEYS];
