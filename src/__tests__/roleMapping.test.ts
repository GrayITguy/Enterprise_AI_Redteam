import { describe, it, expect, afterEach } from "vitest";
import {
  parseGroupRoleMap,
  isRoleMappingEnabled,
  resolveRoleFromGroups,
  normalizeGroups,
} from "../server/services/roleMapping.js";

const saved = process.env.SSO_GROUP_ROLE_MAP;
afterEach(() => {
  if (saved === undefined) delete process.env.SSO_GROUP_ROLE_MAP;
  else process.env.SSO_GROUP_ROLE_MAP = saved;
});

describe("parseGroupRoleMap", () => {
  it("parses group=role pairs and lowercases group keys", () => {
    process.env.SSO_GROUP_ROLE_MAP = "EART-Admins=admin, Security=analyst";
    expect(parseGroupRoleMap()).toEqual({ "eart-admins": "admin", security: "analyst" });
  });

  it("skips invalid roles and malformed entries", () => {
    process.env.SSO_GROUP_ROLE_MAP = "a=superuser, b=, =viewer, c=analyst";
    expect(parseGroupRoleMap()).toEqual({ c: "analyst" });
  });

  it("isRoleMappingEnabled reflects presence of a map", () => {
    delete process.env.SSO_GROUP_ROLE_MAP;
    expect(isRoleMappingEnabled()).toBe(false);
    process.env.SSO_GROUP_ROLE_MAP = "x=viewer";
    expect(isRoleMappingEnabled()).toBe(true);
  });
});

describe("resolveRoleFromGroups", () => {
  it("returns null when no mapping is configured", () => {
    delete process.env.SSO_GROUP_ROLE_MAP;
    expect(resolveRoleFromGroups(["anything"])).toBeNull();
  });

  it("picks the highest-privilege role among matching groups", () => {
    process.env.SSO_GROUP_ROLE_MAP = "admins=admin, readers=viewer, sec=analyst";
    // Member of viewer + admin groups → admin wins (a broad low-priv group can't demote).
    expect(resolveRoleFromGroups(["readers", "admins"])).toBe("admin");
    expect(resolveRoleFromGroups(["readers", "sec"])).toBe("analyst");
  });

  it("is case-insensitive on group names", () => {
    process.env.SSO_GROUP_ROLE_MAP = "Admins=admin";
    expect(resolveRoleFromGroups(["ADMINS"])).toBe("admin");
  });

  it("falls back to a * catch-all when no group matches", () => {
    process.env.SSO_GROUP_ROLE_MAP = "admins=admin, *=viewer";
    expect(resolveRoleFromGroups(["random"])).toBe("viewer");
  });

  it("returns null when nothing matches and no catch-all", () => {
    process.env.SSO_GROUP_ROLE_MAP = "admins=admin";
    expect(resolveRoleFromGroups(["random"])).toBeNull();
  });
});

describe("normalizeGroups", () => {
  it("handles arrays, delimited strings, and empties", () => {
    expect(normalizeGroups(["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeGroups("a, b; c")).toEqual(["a", "b", "c"]);
    expect(normalizeGroups("solo")).toEqual(["solo"]);
    expect(normalizeGroups(undefined)).toEqual([]);
    expect(normalizeGroups(42)).toEqual([]);
  });
});
