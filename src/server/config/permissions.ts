/**
 * Fine-grained permission catalog and the built-in role → permission mapping.
 *
 * EART's three built-in tiers (viewer < analyst < admin) are unchanged and remain
 * the storage model on `users.role`. On top of them, an admin can define **custom
 * roles** (see the `custom_roles` table) that grant an explicit set of the
 * permissions listed here. A user's *effective* permissions are the union of
 * their base-tier permissions and any assigned custom role's permissions
 * (see `permissionService.ts`) — the base tier is a floor, a custom role can only
 * add capability, never remove it. `admin` always holds every permission.
 *
 * This is real, additive RBAC — not a full policy engine. There is no ABAC,
 * per-resource ownership rules, or deny rules; permissions are coarse verbs over
 * resource types. Kept deliberately small and honest.
 */

export type PermissionCategory =
  | "projects"
  | "scans"
  | "results"
  | "reports"
  | "remediation"
  | "users"
  | "roles"
  | "settings"
  | "audit"
  | "retention";

export interface PermissionDef {
  id: string;
  category: PermissionCategory;
  description: string;
}

/**
 * The complete set of assignable permissions. Adding a row here makes a new
 * permission available to custom roles immediately; wire the matching
 * `requirePermission(...)` guard where it should be enforced.
 */
export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  { id: "project:read", category: "projects", description: "View projects and their configuration" },
  { id: "project:create", category: "projects", description: "Create new projects (targets)" },
  { id: "project:update", category: "projects", description: "Edit existing projects" },
  { id: "project:delete", category: "projects", description: "Delete or archive projects" },

  { id: "scan:read", category: "scans", description: "View scans and their status" },
  { id: "scan:create", category: "scans", description: "Start / schedule scans" },
  { id: "scan:cancel", category: "scans", description: "Cancel running scans" },
  { id: "scan:delete", category: "scans", description: "Delete scans" },

  { id: "result:read", category: "results", description: "View individual scan findings" },

  { id: "report:read", category: "reports", description: "View and download generated reports" },
  { id: "report:generate", category: "reports", description: "Generate new reports" },

  { id: "remediation:generate", category: "remediation", description: "Generate AI remediation guidance" },

  { id: "users:manage", category: "users", description: "Create, edit, deactivate and delete users" },
  { id: "roles:manage", category: "roles", description: "Define and edit custom roles" },
  { id: "settings:manage", category: "settings", description: "Change platform settings" },
  { id: "audit:read", category: "audit", description: "Read the audit log" },
  { id: "retention:manage", category: "retention", description: "Run and configure data-retention purges" },
] as const;

export type PermissionId = (typeof PERMISSION_CATALOG)[number]["id"];

/** All valid permission ids as a Set for O(1) validation. */
export const ALL_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSION_CATALOG.map((p) => p.id));

export type BuiltinRole = "admin" | "analyst" | "viewer";

// Viewer: read-only across the platform's non-privileged surface.
const VIEWER_PERMISSIONS: PermissionId[] = [
  "project:read",
  "scan:read",
  "result:read",
  "report:read",
];

// Analyst: everything a viewer can do, plus running the platform (projects,
// scans, reports, remediation) — but no user/role/settings/audit administration.
const ANALYST_PERMISSIONS: PermissionId[] = [
  ...VIEWER_PERMISSIONS,
  "project:create",
  "project:update",
  "project:delete",
  "scan:create",
  "scan:cancel",
  "scan:delete",
  "report:generate",
  "remediation:generate",
];

// Admin holds every permission — computed so a new catalog entry is granted to
// admins automatically and can never be silently withheld.
const ADMIN_PERMISSIONS: PermissionId[] = PERMISSION_CATALOG.map((p) => p.id as PermissionId);

export const BUILTIN_ROLE_PERMISSIONS: Record<BuiltinRole, readonly PermissionId[]> = {
  viewer: VIEWER_PERMISSIONS,
  analyst: ANALYST_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
};

/** Permissions granted by a built-in tier. Unknown roles get nothing. */
export function permissionsForRole(role: string): readonly PermissionId[] {
  return BUILTIN_ROLE_PERMISSIONS[role as BuiltinRole] ?? [];
}

/** Whether admins implicitly hold everything (used to short-circuit checks). */
export function roleHasAllPermissions(role: string): boolean {
  return role === "admin";
}

/** Validate + de-duplicate a list of permission ids against the catalog. */
export function sanitizePermissions(input: unknown): { valid: PermissionId[]; invalid: string[] } {
  const valid: PermissionId[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(input)) return { valid, invalid };
  for (const raw of input) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (ALL_PERMISSIONS.has(id)) valid.push(id as PermissionId);
    else invalid.push(id);
  }
  return { valid, invalid };
}
