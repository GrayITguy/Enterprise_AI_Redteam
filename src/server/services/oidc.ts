/**
 * OpenID Connect (OIDC) SSO — authorization-code flow.
 *
 * Enables "Sign in with SSO" against any standards-compliant OIDC provider
 * (Okta, Azure AD / Entra, Google, Auth0, Keycloak, …). Feature-flagged: the
 * routes only activate when the OIDC_* env vars are set.
 *
 * Flow:
 *   1. /api/auth/oidc/login  → redirect to the IdP's authorize endpoint with a
 *      signed `state` (which embeds a `nonce`), so CSRF/replay protection is
 *      stateless — we verify our own signature on the way back.
 *   2. IdP authenticates the user and redirects to /api/auth/oidc/callback?code&state.
 *   3. Callback verifies `state`, exchanges the code for tokens, cryptographically
 *      verifies the ID token (JWKS signature + iss/aud/exp/nonce), then
 *      find-or-creates the EART user and mints an EART JWT.
 *
 * The ID token is verified against the provider's JWKS — no blind trust.
 */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { errorMessage } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { normalizeGroups } from "./roleMapping.js";

/** Read the signing secret at call time (not module load) so it tracks env. */
function jwtSecret(): string {
  return process.env.JWT_SECRET ?? "dev-secret-change-me";
}

export function isOidcEnabled(): boolean {
  return Boolean(
    process.env.OIDC_ISSUER &&
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_CLIENT_SECRET &&
      process.env.OIDC_REDIRECT_URI
  );
}

function cfg() {
  return {
    issuer: (process.env.OIDC_ISSUER ?? "").replace(/\/+$/, ""),
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
    redirectUri: process.env.OIDC_REDIRECT_URI ?? "",
    scopes: process.env.OIDC_SCOPES ?? "openid email profile",
    allowedDomains: (process.env.OIDC_ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    defaultRole: (process.env.OIDC_DEFAULT_ROLE ?? "viewer") as "admin" | "analyst" | "viewer",
    requireVerifiedEmail: (process.env.OIDC_REQUIRE_VERIFIED_EMAIL ?? "true").toLowerCase() !== "false",
  };
}

// ─── Discovery + JWKS (cached with TTL) ───────────────────────────────────────

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}
interface Jwk {
  kid?: string;
  kty: string;
  [k: string]: unknown;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
let discoveryCache: { at: number; value: Discovery } | null = null;
let jwksCache: { at: number; value: Jwk[] } | null = null;

/** For tests: clear cached discovery/JWKS. */
export function _resetOidcCache(): void {
  discoveryCache = null;
  jwksCache = null;
}

async function getDiscovery(): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < CACHE_TTL_MS) return discoveryCache.value;
  const url = `${cfg().issuer}/.well-known/openid-configuration`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`OIDC discovery failed (${r.status}) at ${url}`);
  const value = (await r.json()) as Discovery;
  if (!value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri) {
    throw new Error("OIDC discovery document is missing required endpoints");
  }
  discoveryCache = { at: Date.now(), value };
  return value;
}

async function getJwks(jwksUri: string): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < CACHE_TTL_MS) return jwksCache.value;
  const r = await fetch(jwksUri, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`OIDC JWKS fetch failed (${r.status})`);
  const body = (await r.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache = { at: Date.now(), value: keys };
  return keys;
}

// ─── Login: build authorize URL with signed state ─────────────────────────────

export interface LoginRedirect {
  url: string;
}

export async function buildLoginRedirect(): Promise<LoginRedirect> {
  const c = cfg();
  const discovery = await getDiscovery();
  const nonce = crypto.randomBytes(16).toString("hex");
  // Stateless CSRF/replay protection: the state is a short-lived signed token we
  // mint and later verify — it also carries the nonce for ID-token binding.
  const state = jwt.sign({ nonce }, jwtSecret(), { subject: "oidc-state", expiresIn: "10m" });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: c.scopes,
    state,
    nonce,
  });
  return { url: `${discovery.authorization_endpoint}?${params.toString()}` };
}

/** Verify the `state` we minted and return the embedded nonce. */
export function verifyState(state: string): string {
  const decoded = jwt.verify(state, jwtSecret(), { subject: "oidc-state" }) as { nonce: string };
  if (!decoded.nonce) throw new Error("state missing nonce");
  return decoded.nonce;
}

// ─── Callback: exchange code, verify ID token, resolve claims ──────────────────

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const c = cfg();
  const discovery = await getDiscovery();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: c.redirectUri,
    client_id: c.clientId,
    client_secret: c.clientSecret,
  });
  const r = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await r.json()) as TokenResponse;
  if (!r.ok || data.error) {
    throw new Error(`OIDC token exchange failed: ${data.error ?? r.status} ${data.error_description ?? ""}`.trim());
  }
  if (!data.id_token) throw new Error("OIDC token response missing id_token");
  return data;
}

export interface OidcClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  groups: string[];
}

/** Verify the ID token signature (JWKS) and standard claims, and the nonce. */
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<OidcClaims> {
  const c = cfg();
  const discovery = await getDiscovery();

  const header = JSON.parse(Buffer.from(idToken.split(".")[0] ?? "", "base64url").toString("utf8")) as {
    kid?: string;
    alg?: string;
  };
  const keys = await getJwks(discovery.jwks_uri);
  const jwk = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];
  if (!jwk) throw new Error("no matching JWKS key for ID token");

  // Convert the JWK to a PEM public key and verify with it.
  const pem = crypto
    .createPublicKey({ key: jwk, format: "jwk" } as crypto.JsonWebKeyInput)
    .export({ type: "spki", format: "pem" }) as string;

  const payload = jwt.verify(idToken, pem, {
    algorithms: [(header.alg as jwt.Algorithm) ?? "RS256"],
    issuer: discovery.issuer || c.issuer,
    audience: c.clientId,
  }) as Record<string, unknown>;

  if (payload.nonce !== expectedNonce) throw new Error("OIDC nonce mismatch (possible replay)");

  const email = (payload.email as string | undefined)?.toLowerCase();
  if (!email) throw new Error("OIDC ID token has no email claim");

  const groupsClaim = process.env.OIDC_GROUPS_CLAIM ?? "groups";
  return {
    sub: String(payload.sub),
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: (payload.name as string | undefined) ?? undefined,
    groups: normalizeGroups(payload[groupsClaim]),
  };
}

/** Enforce email verification + domain allow-list policy on resolved claims. */
export function assertClaimsAllowed(claims: OidcClaims): void {
  const c = cfg();
  if (c.requireVerifiedEmail && !claims.emailVerified) {
    throw new Error("OIDC email is not verified by the identity provider");
  }
  if (c.allowedDomains.length > 0) {
    const domain = claims.email.split("@")[1] ?? "";
    if (!c.allowedDomains.includes(domain)) {
      throw new Error(`OIDC email domain '${domain}' is not permitted`);
    }
  }
}

export function defaultRole(): "admin" | "analyst" | "viewer" {
  return cfg().defaultRole;
}

/** Public (non-secret) SSO status for the frontend login page. */
export function ssoStatus(): { enabled: boolean; loginUrl: string | null } {
  return {
    enabled: isOidcEnabled(),
    loginUrl: isOidcEnabled() ? "/api/auth/oidc/login" : null,
  };
}

/** Full callback pipeline: state → code → verified claims. Throws on any failure. */
export async function handleCallback(code: string, state: string): Promise<OidcClaims> {
  const nonce = verifyState(state);
  const tokens = await exchangeCode(code);
  const claims = await verifyIdToken(tokens.id_token!, nonce);
  assertClaimsAllowed(claims);
  logger.info(`[OIDC] Authenticated ${claims.email} (sub=${claims.sub})`);
  return claims;
}

export { errorMessage };
