import { describe, it, expect } from "vitest";
import {
  getFrameworkMapping,
  frameworkCoverage,
} from "../server/config/frameworkMappings.js";
import { PLUGINS } from "../server/config/pluginCatalog.js";

describe("getFrameworkMapping", () => {
  it("maps injection to ATLAS Prompt Injection + NIST Secure", () => {
    const m = getFrameworkMapping("injection", "LLM01");
    expect(m.atlas.map((a) => a.id)).toContain("AML.T0051");
    expect(m.nist.some((n) => n.includes("Secure"))).toBe(true);
  });

  it("maps privacy to ATLAS Data Leakage + NIST Privacy", () => {
    const m = getFrameworkMapping("privacy", "LLM06");
    expect(m.atlas.map((a) => a.id)).toContain("AML.T0057");
    expect(m.nist.some((n) => n.includes("Privacy"))).toBe(true);
  });

  it("maps bias to NIST Fair", () => {
    const m = getFrameworkMapping("bias", "LLM09");
    expect(m.nist.some((n) => n.includes("Fair"))).toBe(true);
  });

  it("falls back to OWASP category when the plugin category is unknown", () => {
    const m = getFrameworkMapping("some-unknown-category", "LLM06");
    expect(m.atlas.map((a) => a.id)).toContain("AML.T0057");
  });

  it("returns empty mapping when nothing matches", () => {
    const m = getFrameworkMapping("totally-unknown", undefined);
    expect(m.atlas).toEqual([]);
    expect(m.nist).toEqual([]);
  });

  it("every catalog plugin resolves to at least one ATLAS technique", () => {
    const unmapped = PLUGINS.filter(
      (p) => getFrameworkMapping(p.category, p.owaspCategory).atlas.length === 0
    );
    expect(unmapped.map((p) => `${p.id} (${p.category})`)).toEqual([]);
  });
});

describe("frameworkCoverage", () => {
  it("aggregates techniques with total/failed counts", () => {
    const cov = frameworkCoverage([
      { category: "injection", owaspCategory: "LLM01", passed: false },
      { category: "injection", owaspCategory: "LLM01", passed: true },
      { category: "privacy", owaspCategory: "LLM06", passed: false },
    ]);
    const injection = cov.atlas.find((a) => a.key === "AML.T0051");
    expect(injection?.total).toBe(2);
    expect(injection?.failed).toBe(1);
    const leakage = cov.atlas.find((a) => a.key === "AML.T0057");
    expect(leakage?.failed).toBe(1);
    expect(cov.nist.length).toBeGreaterThan(0);
  });

  it("is sorted and includes the indicative-mapping disclaimer", () => {
    const cov = frameworkCoverage([{ category: "jailbreak", owaspCategory: "LLM01", passed: false }]);
    expect(cov.note.toLowerCase()).toContain("not a certified");
  });
});
