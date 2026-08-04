import { describe, it, expect } from "vitest";
import { normalizeWorkerResult } from "../server/services/dockerRunner.js";

describe("normalizeWorkerResult", () => {
  it("maps snake_case worker keys to camelCase (the persistence bug fix)", () => {
    const raw = {
      test_name: "[garak] base64_encoding",
      category: "encoding",
      severity: "high",
      owasp_category: "LLM01",
      prompt: "decode this",
      response: "sure",
      passed: false,
      evidence: { probe: "encoding" },
    };
    const result = normalizeWorkerResult(raw)!;
    expect(result).not.toBeNull();
    expect(result.testName).toBe("[garak] base64_encoding");
    expect(result.owaspCategory).toBe("LLM01");
    expect(result.severity).toBe("high");
    expect(result.passed).toBe(false);
    expect(result.evidence).toEqual({ probe: "encoding" });
  });

  it("also accepts already-camelCase keys", () => {
    const result = normalizeWorkerResult({ testName: "x", passed: true })!;
    expect(result.testName).toBe("x");
    expect(result.passed).toBe(true);
  });

  it("returns null for protocol/error lines with no test name", () => {
    expect(normalizeWorkerResult({ error: "Failed to parse config" })).toBeNull();
    expect(normalizeWorkerResult({ startup: "deepteam 1.0 loaded" })).toBeNull();
  });

  it("coerces an unknown severity to 'medium' and defaults optional fields", () => {
    const result = normalizeWorkerResult({ test_name: "t", severity: "bogus", passed: "yes" })!;
    expect(result.severity).toBe("medium");
    expect(result.category).toBe("unknown");
    expect(result.owaspCategory).toBeNull();
    expect(result.prompt).toBeNull();
    // passed must be a strict boolean — a truthy non-true value is false.
    expect(result.passed).toBe(false);
  });

  it("normalizes non-object evidence to an empty object", () => {
    const result = normalizeWorkerResult({ test_name: "t", passed: true, evidence: "oops" })!;
    expect(result.evidence).toEqual({});
  });
});
