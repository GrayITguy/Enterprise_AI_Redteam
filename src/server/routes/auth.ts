import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { db, getRow, getRows } from "../../db/index.js";
import { users, inviteCodes } from "../../db/schema.js";
import { eq, and, isNull, gt } from "drizzle-orm";
import { generateToken, requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { audit, clientIp } from "../services/auditService.js";
import { logger } from "../utils/logger.js";
import {
  isOidcEnabled,
  ssoStatus,
  buildLoginRedirect,
  handleCallback,
  defaultRole,
  errorMessage,
} from "../services/oidc.js";
import {
  isSamlEnabled,
  buildSamlLoginUrl,
  validateSamlResponse,
  samlMetadata,
  samlDefaultRole,
} from "../services/saml.js";

export const authRouter = Router();
authRouter.use(authLimiter);

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteCode: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── POST /api/auth/setup ────────────────────────────────────────────────────
// First-run: create the first admin account. Only works when users table is empty.
authRouter.post("/setup", async (req, res) => {
  try {
    const existingUsers = await getRows(db.select({ id: users.id }).from(users).limit(1));
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: "Setup already completed. Use /login instead." });
    }

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    const newUser = {
      id: uuid(),
      email,
      passwordHash,
      role: "admin" as const,
      inviteCode: null,
      createdAt: now,
      lastLoginAt: now,
    };

    await db.insert(users).values(newUser);
    const token = generateToken(newUser);

    return res.status(201).json({
      token,
      user: { id: newUser.id, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    return res.status(500).json({ error: "Setup failed" });
  }
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Register with a valid invite code
authRouter.post("/register", async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { email, password, inviteCode } = parsed.data;

    // Verify invite code exists, is unused, and not expired
    if (!inviteCode) {
      return res.status(400).json({ error: "Invite code required for registration" });
    }

    const invite = await getRow(db
      .select()
      .from(inviteCodes)
      .where(
        and(
          eq(inviteCodes.code, inviteCode),
          isNull(inviteCodes.usedBy)
        )
      )
      );

    if (!invite) {
      return res.status(400).json({ error: "Invalid or already used invite code" });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(400).json({ error: "Invite code has expired" });
    }

    // Check email uniqueness
    const existing = await getRow(db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      );

    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const newUser = {
      id: uuid(),
      email,
      passwordHash,
      role: "analyst" as const,
      inviteCode,
      createdAt: now,
      lastLoginAt: now,
    };

    await db.insert(users).values(newUser);

    // Mark invite as used
    await db
      .update(inviteCodes)
      .set({ usedBy: newUser.id })
      .where(eq(inviteCodes.id, invite.id));

    const token = generateToken(newUser);

    return res.status(201).json({
      token,
      user: { id: newUser.id, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    return res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
authRouter.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed" });
    }

    const { email, password } = parsed.data;
    const user = await getRow(db
      .select()
      .from(users)
      .where(eq(users.email, email))
      );

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      void audit({ action: "auth.login_failed", userEmail: email, ip: clientIp(req) });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!user.isActive) {
      void audit({ action: "auth.login_deactivated", userId: user.id, userEmail: email, ip: clientIp(req) });
      return res.status(403).json({ error: "This account has been deactivated" });
    }

    // Update last login
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const token = generateToken(user);

    void audit({
      action: "auth.login",
      userId: user.id,
      userEmail: user.email,
      targetType: "user",
      targetId: user.id,
      ip: clientIp(req),
    });

    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    return res.status(500).json({ error: "Login failed" });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
authRouter.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
  return res.json(req.user);
});

// ─── OIDC SSO ─────────────────────────────────────────────────────────────────

// Public status so the login page can show the right "Sign in with SSO" button.
authRouter.get("/sso/status", (_req, res) => {
  const oidc = ssoStatus();
  const saml = isSamlEnabled();
  return res.json({
    // Back-compat: top-level `enabled`/`loginUrl` reflect OIDC.
    ...oidc,
    oidc,
    saml: { enabled: saml, loginUrl: saml ? "/api/auth/saml/login" : null, metadataUrl: saml ? "/api/auth/saml/metadata" : null },
    anyEnabled: oidc.enabled || saml,
  });
});

// Kick off the OIDC authorization-code flow.
authRouter.get("/oidc/login", async (_req, res) => {
  if (!isOidcEnabled()) return res.status(404).json({ error: "SSO is not configured" });
  try {
    const { url } = await buildLoginRedirect();
    return res.redirect(url);
  } catch (err) {
    logger.error(`[OIDC] login failed: ${errorMessage(err)}`);
    return res.status(502).json({ error: "SSO provider is unavailable" });
  }
});

// OIDC redirect target: verify, provision, mint an EART token, hand off to the SPA.
authRouter.get("/oidc/callback", async (req, res) => {
  if (!isOidcEnabled()) return res.status(404).json({ error: "SSO is not configured" });

  const appUrl = (process.env.APP_URL ?? "http://localhost:15500").replace(/\/+$/, "");
  const fail = (msg: string) => res.redirect(`${appUrl}/login?sso_error=${encodeURIComponent(msg)}`);

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (req.query.error) return fail(String(req.query.error));
  if (!code || !state) return fail("missing_code_or_state");

  try {
    const claims = await handleCallback(code, state);
    const outcome = await resolveOrProvisionSsoUser(claims.email, "oidc", defaultRole(), req);
    if (!outcome.ok) return fail("account_deactivated");
    const token = generateToken(outcome.resolved);
    // Hand the token to the SPA, which stores it and completes login.
    return res.redirect(`${appUrl}/login?sso_token=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.warn(`[OIDC] callback rejected: ${errorMessage(err)}`);
    void audit({ action: "auth.sso_failed", ip: clientIp(req), detail: { provider: "oidc", reason: errorMessage(err) } });
    return fail("sso_verification_failed");
  }
});

// ─── SAML 2.0 SSO ─────────────────────────────────────────────────────────────

// SP-initiated login: redirect the browser to the IdP.
authRouter.get("/saml/login", async (_req, res) => {
  if (!isSamlEnabled()) return res.status(404).json({ error: "SAML SSO is not configured" });
  try {
    const url = await buildSamlLoginUrl();
    return res.redirect(url);
  } catch (err) {
    logger.error(`[SAML] login failed: ${errorMessage(err)}`);
    return res.status(502).json({ error: "SAML provider is unavailable" });
  }
});

// Assertion Consumer Service (ACS): the IdP POSTs the signed SAML response here.
authRouter.post("/saml/callback", async (req, res) => {
  if (!isSamlEnabled()) return res.status(404).json({ error: "SAML SSO is not configured" });
  const appUrl = (process.env.APP_URL ?? "http://localhost:15500").replace(/\/+$/, "");
  const fail = (msg: string) => res.redirect(`${appUrl}/login?sso_error=${encodeURIComponent(msg)}`);

  const samlResponse = typeof req.body?.SAMLResponse === "string" ? req.body.SAMLResponse : null;
  if (!samlResponse) return fail("missing_saml_response");

  try {
    const claims = await validateSamlResponse(samlResponse);
    const outcome = await resolveOrProvisionSsoUser(claims.email, "saml", samlDefaultRole(), req);
    if (!outcome.ok) return fail("account_deactivated");
    const token = generateToken(outcome.resolved);
    return res.redirect(`${appUrl}/login?sso_token=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.warn(`[SAML] callback rejected: ${errorMessage(err)}`);
    void audit({ action: "auth.sso_failed", ip: clientIp(req), detail: { provider: "saml", reason: errorMessage(err) } });
    return fail("sso_verification_failed");
  }
});

// SP metadata XML for registering EART with the IdP.
authRouter.get("/saml/metadata", (_req, res) => {
  if (!isSamlEnabled()) return res.status(404).json({ error: "SAML SSO is not configured" });
  res.type("application/xml").send(samlMetadata());
});

// ─── Shared SSO user resolution ───────────────────────────────────────────────

interface SsoResolveOk {
  ok: true;
  resolved: { id: string; email: string; role: "admin" | "analyst" | "viewer" };
}
type SsoResolveResult = SsoResolveOk | { ok: false; reason: "inactive" };

/**
 * Find-or-create the SSO user (shared by OIDC + SAML). Provisioned users get a
 * non-usable password hash so they can never authenticate via the password
 * endpoint. Deactivated (SCIM-disabled) users are refused. Audit-logged.
 */
async function resolveOrProvisionSsoUser(
  email: string,
  provider: "oidc" | "saml",
  role: "admin" | "analyst" | "viewer",
  req: import("express").Request
): Promise<SsoResolveResult> {
  const existing = await getRow(db.select().from(users).where(eq(users.email, email)));
  if (existing) {
    if (!existing.isActive) {
      void audit({ action: "auth.sso_deactivated", userId: existing.id, userEmail: existing.email, detail: { provider }, ip: clientIp(req) });
      return { ok: false, reason: "inactive" };
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, existing.id));
    void audit({ action: "auth.sso_login", userId: existing.id, userEmail: existing.email, targetType: "user", targetId: existing.id, detail: { provider }, ip: clientIp(req) });
    return { ok: true, resolved: { id: existing.id, email: existing.email, role: existing.role } };
  }
  const now = new Date();
  const newUser = {
    id: uuid(),
    email,
    passwordHash: `sso:${provider}:no-password`,
    role,
    inviteCode: null,
    isActive: true,
    externalId: null,
    createdAt: now,
    lastLoginAt: now,
  };
  await db.insert(users).values(newUser);
  void audit({ action: "auth.sso_provision", userId: newUser.id, userEmail: newUser.email, targetType: "user", targetId: newUser.id, detail: { provider, role }, ip: clientIp(req) });
  void audit({ action: "auth.sso_login", userId: newUser.id, userEmail: newUser.email, targetType: "user", targetId: newUser.id, detail: { provider }, ip: clientIp(req) });
  return { ok: true, resolved: { id: newUser.id, email: newUser.email, role: newUser.role } };
}

// ─── POST /api/auth/invite ────────────────────────────────────────────────────
// Admin-only: create invite codes
authRouter.post("/invite", requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const parsed = z
    .object({ expiresInDays: z.number().int().min(1).max(365).optional() })
    .safeParse(req.body);

  const expiresInDays = parsed.success ? parsed.data.expiresInDays : undefined;
  const code = `EART-${uuid().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const now = new Date();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400_000)
    : null;

  await db.insert(inviteCodes).values({
    id: uuid(),
    code,
    createdBy: req.user.id,
    usedBy: null,
    expiresAt,
    createdAt: now,
  });

  return res.status(201).json({ code, expiresAt });
});
