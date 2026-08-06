import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  isOidcEnabled,
  ssoStatus,
  verifyState,
  verifyIdToken,
  assertClaimsAllowed,
  handleCallback,
  _resetOidcCache,
} from "../server/services/oidc.js";

// A stable RSA keypair for signing test ID tokens.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };

const ISSUER = "https://idp.example.com";
const CLIENT_ID = "eart-client";

const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
};

function setEnv() {
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  process.env.OIDC_CLIENT_SECRET = "secret";
  process.env.OIDC_REDIRECT_URI = "https://eart.example.com/api/auth/oidc/callback";
  process.env.JWT_SECRET = "test-secret-long-enough-for-signing-000000000000";
}

function makeIdToken(overrides: Record<string, unknown> = {}, nonce = "n1") {
  return jwt.sign(
    { email: "user@corp.com", email_verified: true, name: "User", nonce, ...overrides },
    privateKey,
    { algorithm: "RS256", issuer: ISSUER, audience: CLIENT_ID, subject: "sub-123", expiresIn: "5m", keyid: "test-key" }
  );
}

/** Mock global fetch for discovery / JWKS / token endpoints. */
function mockFetch(tokenResponse: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, ok = true, status = 200) =>
        ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
      if (url.endsWith("/.well-known/openid-configuration")) return json(DISCOVERY);
      if (url.endsWith("/jwks")) return json({ keys: [jwk] });
      if (url.endsWith("/token") && init?.method === "POST") return json(tokenResponse);
      throw new Error(`unexpected fetch ${url}`);
    })
  );
}

const OIDC_KEYS = [
  "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI",
  "OIDC_ALLOWED_DOMAINS", "OIDC_REQUIRE_VERIFIED_EMAIL", "OIDC_DEFAULT_ROLE",
];
const saved: Record<string, string | undefined> = {};
for (const k of [...OIDC_KEYS, "JWT_SECRET"]) saved[k] = process.env[k];

beforeEach(() => {
  _resetOidcCache();
  setEnv();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of [...OIDC_KEYS, "JWT_SECRET"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("OIDC enablement", () => {
  it("is enabled only when all required vars are set", () => {
    expect(isOidcEnabled()).toBe(true);
    expect(ssoStatus().enabled).toBe(true);
    delete process.env.OIDC_CLIENT_SECRET;
    expect(isOidcEnabled()).toBe(false);
    expect(ssoStatus().loginUrl).toBeNull();
  });
});

describe("state signing", () => {
  it("round-trips a signed state and rejects a forged one", () => {
    const state = jwt.sign({ nonce: "xyz" }, process.env.JWT_SECRET!, { subject: "oidc-state", expiresIn: "10m" });
    expect(verifyState(state)).toBe("xyz");
    expect(() => verifyState("not-a-jwt")).toThrow();
    // Signed with a different secret → rejected.
    const forged = jwt.sign({ nonce: "xyz" }, "other-secret", { subject: "oidc-state" });
    expect(() => verifyState(forged)).toThrow();
  });
});

describe("verifyIdToken", () => {
  it("accepts a valid, correctly-signed ID token", async () => {
    mockFetch({});
    const claims = await verifyIdToken(makeIdToken({}, "n1"), "n1");
    expect(claims.email).toBe("user@corp.com");
    expect(claims.emailVerified).toBe(true);
    expect(claims.sub).toBe("sub-123");
  });

  it("rejects a nonce mismatch (replay)", async () => {
    mockFetch({});
    await expect(verifyIdToken(makeIdToken({}, "n1"), "different")).rejects.toThrow(/nonce/i);
  });

  it("rejects a token signed by an unknown key", async () => {
    mockFetch({});
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const bad = jwt.sign({ email: "e@corp.com", nonce: "n1" }, other.privateKey, {
      algorithm: "RS256", issuer: ISSUER, audience: CLIENT_ID, subject: "s", keyid: "test-key",
    });
    await expect(verifyIdToken(bad, "n1")).rejects.toThrow();
  });

  it("rejects a wrong audience", async () => {
    mockFetch({});
    const bad = jwt.sign({ email: "e@corp.com", nonce: "n1" }, privateKey, {
      algorithm: "RS256", issuer: ISSUER, audience: "someone-else", subject: "s", keyid: "test-key",
    });
    await expect(verifyIdToken(bad, "n1")).rejects.toThrow();
  });
});

describe("assertClaimsAllowed", () => {
  it("enforces the domain allow-list", () => {
    process.env.OIDC_ALLOWED_DOMAINS = "corp.com";
    expect(() => assertClaimsAllowed({ sub: "s", email: "user@corp.com", emailVerified: true })).not.toThrow();
    expect(() => assertClaimsAllowed({ sub: "s", email: "user@evil.com", emailVerified: true })).toThrow(/domain/i);
  });

  it("requires a verified email unless disabled", () => {
    expect(() => assertClaimsAllowed({ sub: "s", email: "u@corp.com", emailVerified: false })).toThrow(/verified/i);
    process.env.OIDC_REQUIRE_VERIFIED_EMAIL = "false";
    expect(() => assertClaimsAllowed({ sub: "s", email: "u@corp.com", emailVerified: false })).not.toThrow();
  });
});

describe("handleCallback (full pipeline)", () => {
  it("verifies state, exchanges the code, and returns claims", async () => {
    const nonce = "n42";
    mockFetch({ id_token: makeIdToken({}, nonce), access_token: "at" });
    const state = jwt.sign({ nonce }, process.env.JWT_SECRET!, { subject: "oidc-state", expiresIn: "10m" });
    const claims = await handleCallback("auth-code", state);
    expect(claims.email).toBe("user@corp.com");
  });

  it("fails when the token endpoint returns an error", async () => {
    mockFetch({ error: "invalid_grant" });
    const state = jwt.sign({ nonce: "n1" }, process.env.JWT_SECRET!, { subject: "oidc-state", expiresIn: "10m" });
    await expect(handleCallback("bad-code", state)).rejects.toThrow(/invalid_grant|token exchange/i);
  });
});
