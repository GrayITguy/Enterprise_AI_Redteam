import { describe, it, expect } from "vitest";
import { assertUrlNotBlocked, BlockedTargetError } from "../server/utils/urlValidation.js";

describe("assertUrlNotBlocked (SSRF guard)", () => {
  it("blocks the cloud metadata IP", () => {
    expect(() => assertUrlNotBlocked("http://169.254.169.254/latest/meta-data/")).toThrow(
      BlockedTargetError
    );
  });

  it("blocks the ECS task metadata IP and GCP metadata hostname", () => {
    expect(() => assertUrlNotBlocked("http://169.254.170.2/v2/credentials")).toThrow(
      BlockedTargetError
    );
    expect(() => assertUrlNotBlocked("http://metadata.google.internal/")).toThrow(
      BlockedTargetError
    );
  });

  it("blocks IPv4 and IPv6 link-local ranges", () => {
    expect(() => assertUrlNotBlocked("http://169.254.42.42/")).toThrow(BlockedTargetError);
    expect(() => assertUrlNotBlocked("http://[fe80::1]/")).toThrow(BlockedTargetError);
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertUrlNotBlocked("file:///etc/passwd")).toThrow(BlockedTargetError);
    expect(() => assertUrlNotBlocked("gopher://evil/")).toThrow(BlockedTargetError);
  });

  it("rejects malformed URLs", () => {
    expect(() => assertUrlNotBlocked("not a url")).toThrow(BlockedTargetError);
  });

  it("allows legitimate local and public targets", () => {
    expect(() => assertUrlNotBlocked("http://localhost:11434")).not.toThrow();
    expect(() => assertUrlNotBlocked("http://127.0.0.1:11434/api/chat")).not.toThrow();
    expect(() => assertUrlNotBlocked("http://192.168.1.50:11434")).not.toThrow();
    expect(() => assertUrlNotBlocked("https://api.openai.com")).not.toThrow();
  });
});
