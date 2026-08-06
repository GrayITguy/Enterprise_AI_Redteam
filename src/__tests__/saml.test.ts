import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isSamlEnabled,
  buildSamlLoginUrl,
  samlMetadata,
  validateSamlResponse,
  samlDefaultRole,
} from "../server/services/saml.js";

// A throwaway self-signed X.509 cert (test-only, not a secret) so node-saml can
// construct. Signature-crypto correctness is the library's own test suite's job;
// these tests cover EART's integration wiring.
const TEST_IDP_CERT = `-----BEGIN CERTIFICATE-----
MIIDBzCCAe+gAwIBAgIUJ6mckXy/n/Ei4XrnwVsOddAHQjIwDQYJKoZIhvcNAQEL
BQAwEzERMA8GA1UEAwwIdGVzdC1pZHAwHhcNMjYwODA2MTMxMzAwWhcNMzYwODAz
MTMxMzAwWjATMREwDwYDVQQDDAh0ZXN0LWlkcDCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBALiK6WJ2OvxCCAuE1cbmkFXvVpD+M+xGdmExOqdrwj5B9ex4
tHXMzkAXhBvpWfsQoRpS4glfXo+8+hoi7NgAREjHOfqzIKU2O8Q0jhViAdc3jQfM
AOXs17yBn4xCPu51UeKv6mJusBE0Cm0rjoXppU3VbR081XyJLLsj6sGRl+omHQaG
s7+44dZo/SbMpDG4IkPDXrkr9WylRJ2HQZr05Xzkkir5yMHrKU3+cObl8+owK55O
B4c/5Clq0xO7FSoQSqzc/xUgnjLU4PJXkt9+/4KwmrANruqa7YpXs4ysG2tlSX/c
TPEK07dV14mc2r6QMky9uGziwF3hQVkGVijVGuECAwEAAaNTMFEwHQYDVR0OBBYE
FKyX6B5cgguCI2J0tfDIluGerqGuMB8GA1UdIwQYMBaAFKyX6B5cgguCI2J0tfDI
luGerqGuMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAFjo7Brv
4ZJnNi/yadBuKZISGivnYUuWNcQODb0z1vh3tzgdXCtAv8ssbaCQpllKbVG4C+c8
969nEzvuJOFbMkju8F/84SbSyxYGyKC3/abNigDbty8gTEKq+BmvnBO6ztpS+JK9
/bKWjqFEgeyRvxaDR6gN78I/CBwjDCIdyLQmEnw4FG0W5oABL96UvdbxLxhMey/5
mcxNnuD9yoqXukkHL1EZpjmSoV6N89uwPIjDcm3ZjgCE8J4Dcp3djsEkVZ7jsMQj
ZBG9w93u5MZQODxIYpFE+Y0ip0A/vIHHxuHHtTTKRbKRWI+X44cS165srV3GsG0C
m/7iTvpc0KROk44=
-----END CERTIFICATE-----`;

const KEYS = [
  "SAML_ENTRY_POINT", "SAML_ISSUER", "SAML_CALLBACK_URL", "SAML_IDP_CERT",
  "SAML_ALLOWED_DOMAINS", "SAML_DEFAULT_ROLE",
];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

function enable() {
  process.env.SAML_ENTRY_POINT = "https://idp.example.com/sso";
  process.env.SAML_ISSUER = "eart-sp";
  process.env.SAML_CALLBACK_URL = "https://eart.example.com/api/auth/saml/callback";
  process.env.SAML_IDP_CERT = TEST_IDP_CERT;
}

beforeEach(() => enable());
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("SAML enablement + config", () => {
  it("is enabled only when all required vars are set", () => {
    expect(isSamlEnabled()).toBe(true);
    delete process.env.SAML_IDP_CERT;
    expect(isSamlEnabled()).toBe(false);
  });

  it("defaults the provisioning role to viewer", () => {
    expect(samlDefaultRole()).toBe("viewer");
    process.env.SAML_DEFAULT_ROLE = "analyst";
    expect(samlDefaultRole()).toBe("analyst");
  });
});

describe("SAML AuthnRequest + metadata", () => {
  it("builds a login redirect URL to the IdP with a SAMLRequest", async () => {
    const url = await buildSamlLoginUrl();
    expect(url.startsWith("https://idp.example.com/sso")).toBe(true);
    expect(url).toContain("SAMLRequest=");
  });

  it("generates SP metadata containing the entityID and ACS URL", () => {
    const xml = samlMetadata();
    expect(xml).toContain("EntityDescriptor");
    expect(xml).toContain("eart-sp");
    expect(xml).toContain("https://eart.example.com/api/auth/saml/callback");
  });
});

describe("SAML response validation", () => {
  it("rejects a garbage/unsigned SAML response (never blindly accepts)", async () => {
    const bogus = Buffer.from("<samlp:Response>not signed</samlp:Response>").toString("base64");
    await expect(validateSamlResponse(bogus)).rejects.toThrow();
  });

  it("rejects a non-base64 / malformed response", async () => {
    await expect(validateSamlResponse("!!!not-base64!!!")).rejects.toThrow();
  });
});
