import { describe, it, expect } from "vitest";
import { redactProviderConfig, mergeProviderSecrets } from "../server/utils/helpers.js";

describe("redactProviderConfig", () => {
  it("removes apiKey and reports it via hasApiKey", () => {
    const out = redactProviderConfig({ model: "gpt-4o-mini", apiKey: "sk-secret" });
    expect(out).not.toHaveProperty("apiKey");
    expect(out.hasApiKey).toBe(true);
    expect(out.model).toBe("gpt-4o-mini");
  });

  it("reports hasApiKey=false when no secret is present", () => {
    const out = redactProviderConfig({ model: "llama3" });
    expect(out.hasApiKey).toBe(false);
  });

  it("masks Authorization-style header values but keeps header names", () => {
    const out = redactProviderConfig({
      headers: { Authorization: "Bearer sk-xyz", "X-Trace": "keep-me" },
    });
    const headers = out.headers as Record<string, string>;
    expect(headers.Authorization).toBe("***");
    expect(headers["X-Trace"]).toBe("keep-me");
  });
});

describe("mergeProviderSecrets", () => {
  it("preserves a stored apiKey when the incoming config omits it", () => {
    const merged = mergeProviderSecrets({ model: "gpt-4o" }, { apiKey: "sk-stored" });
    expect(merged.apiKey).toBe("sk-stored");
    expect(merged.model).toBe("gpt-4o");
  });

  it("lets an incoming apiKey override the stored one", () => {
    const merged = mergeProviderSecrets({ apiKey: "sk-new" }, { apiKey: "sk-old" });
    expect(merged.apiKey).toBe("sk-new");
  });
});
