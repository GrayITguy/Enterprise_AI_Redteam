/**
 * IdP group → EART role mapping (shared by OIDC and SAML SSO).
 *
 * Configure with `SSO_GROUP_ROLE_MAP`, a comma-separated list of
 * `group=role` pairs, e.g.:
 *
 *   SSO_GROUP_ROLE_MAP="EART-Admins=admin, Security-Team=analyst, *=viewer"
 *
 * Group names are matched case-insensitively. A literal `*` entry is a
 * catch-all applied when no other group matches. When a user belongs to several
 * mapped groups, the **highest-privilege** role wins (admin > analyst > viewer)
 * so adding a broad low-privilege group can never demote an admin.
 */
export type EartRole = "admin" | "analyst" | "viewer";

const RANK: Record<EartRole, number> = { viewer: 0, analyst: 1, admin: 2 };

/** Parse SSO_GROUP_ROLE_MAP into { group(lowercased) → role }. Invalid entries are skipped. */
export function parseGroupRoleMap(): Record<string, EartRole> {
  const raw = process.env.SSO_GROUP_ROLE_MAP ?? "";
  const out: Record<string, EartRole> = {};
  for (const pair of raw.split(",")) {
    const [group, role] = pair.split("=").map((s) => s.trim());
    if (!group || !role) continue;
    const r = role.toLowerCase();
    if (r === "admin" || r === "analyst" || r === "viewer") {
      out[group.toLowerCase()] = r as EartRole;
    }
  }
  return out;
}

/** Whether a group→role mapping is configured. */
export function isRoleMappingEnabled(): boolean {
  return Object.keys(parseGroupRoleMap()).length > 0;
}

/**
 * Resolve an EART role from the user's IdP groups. Returns the highest-privilege
 * role among matching groups; if none match but a `*` catch-all is configured,
 * that is used; otherwise `null` (caller applies its own default).
 */
export function resolveRoleFromGroups(groups: string[]): EartRole | null {
  const map = parseGroupRoleMap();
  if (Object.keys(map).length === 0) return null;

  let best: EartRole | null = null;
  for (const g of groups) {
    const role = map[String(g).toLowerCase()];
    if (role && (best === null || RANK[role] > RANK[best])) best = role;
  }
  if (best === null && map["*"]) best = map["*"];
  return best;
}

/** Coerce an unknown groups claim/attribute into a string array. */
export function normalizeGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    // Some IdPs send a single group or a comma/semicolon-separated string.
    return value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
