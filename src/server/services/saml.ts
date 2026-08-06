/**
 * SAML 2.0 SSO — service provider (SP).
 *
 * Uses the vetted @node-saml/node-saml library for AuthnRequest generation and,
 * critically, **signed-assertion validation** (XML signature + conditions).
 * Hand-rolling XML-DSig verification is how signature-wrapping vulnerabilities
 * happen, so this deliberately delegates the crypto to a maintained library.
 *
 * Feature-flagged: routes only activate when the SAML_* env vars are set.
 */
import { SAML } from "@node-saml/node-saml";

export function isSamlEnabled(): boolean {
  return Boolean(
    process.env.SAML_ENTRY_POINT &&
      process.env.SAML_ISSUER &&
      process.env.SAML_CALLBACK_URL &&
      process.env.SAML_IDP_CERT
  );
}

function allowedDomains(): string[] {
  return (process.env.SAML_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function samlDefaultRole(): "admin" | "analyst" | "viewer" {
  return (process.env.SAML_DEFAULT_ROLE ?? "viewer") as "admin" | "analyst" | "viewer";
}

/** Build the node-saml SAML instance from environment configuration. */
function getSaml(): SAML {
  return new SAML({
    entryPoint: process.env.SAML_ENTRY_POINT!,
    issuer: process.env.SAML_ISSUER!, // SP entityID
    callbackUrl: process.env.SAML_CALLBACK_URL!, // ACS URL
    idpCert: process.env.SAML_IDP_CERT!, // IdP signing certificate (PEM body)
    audience: process.env.SAML_AUDIENCE ?? process.env.SAML_ISSUER!,
    wantAssertionsSigned: (process.env.SAML_WANT_ASSERTIONS_SIGNED ?? "true").toLowerCase() !== "false",
    // We do not decrypt assertions or sign requests by default (no SP key needed).
    signatureAlgorithm: "sha256",
  });
}

/** The URL to redirect the browser to, to begin SP-initiated SAML login. */
export async function buildSamlLoginUrl(): Promise<string> {
  const saml = getSaml();
  return saml.getAuthorizeUrlAsync("", "", {});
}

export interface SamlClaims {
  email: string;
  name?: string;
  nameId?: string;
}

const EMAIL_ATTRS = [
  "email",
  "mail",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "urn:oid:0.9.2342.19200300.100.1.3",
];

function extractEmail(profile: Record<string, unknown>): string | null {
  for (const key of EMAIL_ATTRS) {
    const v = profile[key];
    if (typeof v === "string" && v.includes("@")) return v.toLowerCase();
  }
  const attrs = (profile.attributes as Record<string, unknown> | undefined) ?? {};
  for (const key of EMAIL_ATTRS) {
    const v = attrs[key];
    if (typeof v === "string" && v.includes("@")) return v.toLowerCase();
  }
  const nameId = profile.nameID as string | undefined;
  if (nameId && nameId.includes("@")) return nameId.toLowerCase();
  return null;
}

/**
 * Validate a SAML POST response (the assertion). node-saml verifies the XML
 * signature against the configured IdP cert and checks the assertion
 * conditions; we then extract the email and enforce the domain allow-list.
 */
export async function validateSamlResponse(samlResponse: string): Promise<SamlClaims> {
  const saml = getSaml();
  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) throw new Error("SAML response contained no profile");

  const email = extractEmail(profile as unknown as Record<string, unknown>);
  if (!email) throw new Error("SAML assertion has no email attribute or emailish NameID");

  const domains = allowedDomains();
  if (domains.length > 0) {
    const domain = email.split("@")[1] ?? "";
    if (!domains.includes(domain)) throw new Error(`SAML email domain '${domain}' is not permitted`);
  }

  return {
    email,
    name: (profile as Record<string, unknown>).displayName as string | undefined,
    nameId: (profile as Record<string, unknown>).nameID as string | undefined,
  };
}

/** SP metadata XML for registering EART with the IdP. */
export function samlMetadata(): string {
  return getSaml().generateServiceProviderMetadata(null, null);
}
