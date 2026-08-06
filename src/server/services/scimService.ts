/**
 * SCIM 2.0 (RFC 7643/7644) helpers — representation, parsing, and errors.
 *
 * EART acts as a SCIM *service provider* so an IdP (Okta, Entra, …) can
 * provision, update, and deprovision users. This module keeps the wire-format
 * mapping in one place; the route layer handles auth + persistence.
 */
export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export type EartRole = "admin" | "analyst" | "viewer";

export interface DbUser {
  id: string;
  email: string;
  role: EartRole;
  isActive: boolean;
  externalId?: string | null;
  createdAt: Date;
  lastLoginAt?: Date | null;
}

/** Serialize an EART user as a SCIM User resource. */
export function toScimUser(u: DbUser): Record<string, unknown> {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    externalId: u.externalId ?? undefined,
    userName: u.email,
    name: { formatted: u.email },
    emails: [{ value: u.email, primary: true }],
    roles: [{ value: u.role }],
    active: u.isActive,
    meta: {
      resourceType: "User",
      created: u.createdAt.toISOString(),
      lastModified: (u.lastLoginAt ?? u.createdAt).toISOString(),
      location: `/scim/v2/Users/${u.id}`,
    },
  };
}

export function scimListResponse(
  resources: Record<string, unknown>[],
  totalResults: number,
  startIndex: number
): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function scimError(status: number, detail: string, scimType?: string): Record<string, unknown> {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

/** Normalize an incoming SCIM role list to a valid EART role (or undefined). */
export function roleFromScim(roles: unknown): EartRole | undefined {
  const allowed: EartRole[] = ["admin", "analyst", "viewer"];
  if (Array.isArray(roles)) {
    for (const r of roles) {
      const v = (typeof r === "string" ? r : (r as { value?: string })?.value)?.toLowerCase();
      if (v && (allowed as string[]).includes(v)) return v as EartRole;
    }
  }
  return undefined;
}

export interface ParsedScimUser {
  email: string;
  active: boolean;
  role?: EartRole;
  externalId?: string;
}

/** Parse a SCIM User body (POST/PUT) into fields EART persists. */
export function parseScimUser(body: Record<string, unknown>): ParsedScimUser | { error: string } {
  const emails = body.emails as Array<{ value?: string; primary?: boolean }> | undefined;
  const primaryEmail = emails?.find((e) => e.primary)?.value ?? emails?.[0]?.value;
  const email = ((body.userName as string | undefined) ?? primaryEmail ?? "").toLowerCase().trim();
  if (!email || !email.includes("@")) return { error: "userName (email) is required" };

  return {
    email,
    active: body.active === undefined ? true : body.active === true,
    role: roleFromScim(body.roles),
    externalId: (body.externalId as string | undefined) ?? undefined,
  };
}

export interface PatchChange {
  active?: boolean;
  role?: EartRole;
}

/**
 * Interpret a SCIM PATCH PatchOp into the subset EART supports (active + role).
 * Handles both `path`-scoped and full-object `value` replace operations.
 */
export function parseScimPatch(body: Record<string, unknown>): PatchChange {
  const change: PatchChange = {};
  const ops = (body.Operations ?? body.operations) as
    | Array<{ op?: string; path?: string; value?: unknown }>
    | undefined;
  if (!Array.isArray(ops)) return change;

  for (const op of ops) {
    const action = (op.op ?? "").toLowerCase();
    if (action === "remove") continue;
    const path = (op.path ?? "").toLowerCase();

    if (path === "active") {
      change.active = op.value === true || op.value === "true";
    } else if (path === "roles" || path === "roles.value") {
      const r = roleFromScim(op.value);
      if (r) change.role = r;
    } else if (!path && op.value && typeof op.value === "object") {
      // Pathless replace: the value is a partial resource.
      const v = op.value as Record<string, unknown>;
      if (v.active !== undefined) change.active = v.active === true || v.active === "true";
      const r = roleFromScim(v.roles);
      if (r) change.role = r;
    }
  }
  return change;
}
