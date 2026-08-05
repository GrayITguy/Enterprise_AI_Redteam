import { describe, it, expect, afterEach } from "vitest";
import {
  assertTargetAuthorized,
  targetAllowlistEnabled,
  UnauthorizedTargetError,
  BlockedTargetError,
} from "../server/utils/urlValidation.js";
import { estimateScan, estimatePluginCalls, maxTargetCalls } from "../server/services/scanEstimate.js";
import { throttleTargetCall, _resetThrottle } from "../server/services/targetThrottle.js";

const ENV_KEYS = ["TARGET_ALLOWLIST", "SCAN_MAX_TARGET_CALLS", "SCAN_TARGET_RATE_LIMIT"];
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetThrottle();
});

describe("target authorization allow-list", () => {
  it("is disabled (permissive) when TARGET_ALLOWLIST is unset", () => {
    delete process.env.TARGET_ALLOWLIST;
    expect(targetAllowlistEnabled()).toBe(false);
    expect(() => assertTargetAuthorized("https://any-host.example.com")).not.toThrow();
  });

  it("allows exact and wildcard matches when configured", () => {
    process.env.TARGET_ALLOWLIST = "api.mycorp.com, *.internal.mycorp.com";
    expect(targetAllowlistEnabled()).toBe(true);
    expect(() => assertTargetAuthorized("https://api.mycorp.com/v1")).not.toThrow();
    expect(() => assertTargetAuthorized("https://llm.internal.mycorp.com")).not.toThrow();
    expect(() => assertTargetAuthorized("https://internal.mycorp.com")).not.toThrow(); // apex
  });

  it("rejects hosts not in the allow-list", () => {
    process.env.TARGET_ALLOWLIST = "api.mycorp.com";
    expect(() => assertTargetAuthorized("https://evil.example.com")).toThrow(UnauthorizedTargetError);
  });

  it("still blocks SSRF targets even when they would match a pattern", () => {
    process.env.TARGET_ALLOWLIST = "*";
    // metadata IP is blocked by the SSRF layer regardless of the allow-list
    expect(() => assertTargetAuthorized("http://169.254.169.254")).toThrow(BlockedTargetError);
  });
});

describe("scan cost estimate", () => {
  it("estimates promptfoo plugins by their attack count", () => {
    // system-prompt-leak has multiple regex attacks defined
    expect(estimatePluginCalls("promptfoo:system-prompt-leak")).toBeGreaterThanOrEqual(1);
  });

  it("estimates docker-engine plugins with bounded upper counts", () => {
    expect(estimatePluginCalls("garak:dan-variants")).toBeGreaterThan(0);
    expect(estimatePluginCalls("pyrit:tap-attack")).toBeGreaterThan(0);
    expect(estimatePluginCalls("deepteam:toxic-content")).toBeGreaterThan(0);
  });

  it("aggregates target calls per engine and flags over-limit scans", () => {
    process.env.SCAN_MAX_TARGET_CALLS = "5";
    const est = estimateScan(["pyrit:tap-attack", "pyrit:pair-attack", "garak:dan-variants"]);
    expect(est.targetCalls).toBeGreaterThan(5);
    expect(est.exceedsLimit).toBe(true);
    expect(Object.keys(est.byEngine)).toContain("pyrit");
  });

  it("does not flag when under the limit", () => {
    process.env.SCAN_MAX_TARGET_CALLS = "100000";
    const est = estimateScan(["promptfoo:jailbreak"]);
    expect(est.exceedsLimit).toBe(false);
  });

  it("treats SCAN_MAX_TARGET_CALLS=0 as unlimited", () => {
    process.env.SCAN_MAX_TARGET_CALLS = "0";
    expect(maxTargetCalls()).toBe(0);
    const est = estimateScan(["pyrit:tap-attack", "pyrit:pair-attack"]);
    expect(est.exceedsLimit).toBe(false);
  });
});

describe("target-call throttle", () => {
  it("returns immediately when the rate limit is unset", async () => {
    delete process.env.SCAN_TARGET_RATE_LIMIT;
    const start = Date.now();
    await throttleTargetCall();
    await throttleTargetCall();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("spaces successive calls when a rate limit is set", async () => {
    process.env.SCAN_TARGET_RATE_LIMIT = "600"; // 600/min → 100ms spacing
    _resetThrottle();
    const start = Date.now();
    await throttleTargetCall(); // first is free
    await throttleTargetCall(); // must wait ~100ms
    expect(Date.now() - start).toBeGreaterThanOrEqual(80);
  });
});
