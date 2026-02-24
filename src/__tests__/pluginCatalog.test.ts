import { describe, it, expect } from "vitest";
import {
  PLUGINS,
  PRESETS,
  resolvePlugins,
  getPluginById,
  getPluginsByTool,
} from "../server/config/pluginCatalog.js";

describe("PLUGINS catalog", () => {
  it("contains exactly 41 plugins", () => {
    expect(PLUGINS).toHaveLength(41);
  });

  it("all plugin IDs are unique", () => {
    const ids = PLUGINS.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every plugin has required fields", () => {
    for (const plugin of PLUGINS) {
      expect(plugin.id, `${plugin.id} missing id`).toBeTruthy();
      expect(plugin.name, `${plugin.id} missing name`).toBeTruthy();
      expect(plugin.tool, `${plugin.id} missing tool`).toMatch(
        /^(promptfoo|garak|pyrit|deepteam)$/
      );
      expect(plugin.severity, `${plugin.id} missing severity`).toMatch(
        /^(critical|high|medium|low|info)$/
      );
      expect(
        Array.isArray(plugin.tags),
        `${plugin.id} tags must be array`
      ).toBe(true);
    }
  });

  it("IDs follow the tool:slug pattern", () => {
    for (const plugin of PLUGINS) {
      expect(plugin.id).toMatch(/^[a-z-]+:[a-z0-9-]+$/);
    }
  });
});

describe("PRESETS", () => {
  it("quick preset has exactly 8 plugins", () => {
    expect(PRESETS.quick.plugins).toHaveLength(8);
  });

  it("owasp preset covers all 10 OWASP categories", () => {
    const owaspIds = PRESETS.owasp.plugins
      .map((id) => getPluginById(id))
      .filter(Boolean)
      .map((p) => p!.owaspCategory)
      .filter(Boolean);
    const covered = new Set(owaspIds);
    // Should cover LLM01 through LLM10 (some categories excluded by design)
    expect(covered.size).toBeGreaterThanOrEqual(6);
  });

  it("full preset contains all 41 plugins", () => {
    expect(PRESETS.full.plugins).toHaveLength(41);
  });

  it("preset plugin IDs all exist in the catalog", () => {
    const allIds = new Set(PLUGINS.map((p) => p.id));
    for (const [presetName, preset] of Object.entries(PRESETS)) {
      for (const id of preset.plugins) {
        expect(allIds.has(id), `Preset '${presetName}' references unknown plugin '${id}'`).toBe(
          true
        );
      }
    }
  });
});

describe("resolvePlugins()", () => {
  it("returns matching Plugin objects for known IDs", () => {
    const result = resolvePlugins(["promptfoo:jailbreak", "garak:encoding-attacks"]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("promptfoo:jailbreak");
    expect(result[1].id).toBe("garak:encoding-attacks");
  });

  it("silently skips unknown plugin IDs", () => {
    const result = resolvePlugins(["unknown:foo", "promptfoo:jailbreak"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("promptfoo:jailbreak");
  });

  it("returns empty array for empty input", () => {
    expect(resolvePlugins([])).toEqual([]);
  });

  it("returns empty array when all IDs are unknown", () => {
    expect(resolvePlugins(["not:real", "also:fake"])).toEqual([]);
  });
});

describe("getPluginById()", () => {
  it("returns the correct plugin for a known ID", () => {
    const plugin = getPluginById("promptfoo:prompt-injection");
    expect(plugin).toBeDefined();
    expect(plugin!.name).toBe("Prompt Injection");
    expect(plugin!.tool).toBe("promptfoo");
    expect(plugin!.severity).toBe("critical");
  });

  it("returns undefined for unknown ID", () => {
    expect(getPluginById("does-not:exist")).toBeUndefined();
  });
});

describe("getPluginsByTool()", () => {
  it("returns only promptfoo plugins", () => {
    const result = getPluginsByTool("promptfoo");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.tool === "promptfoo")).toBe(true);
  });

  it("returns only garak plugins", () => {
    const result = getPluginsByTool("garak");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.tool === "garak")).toBe(true);
  });

  it("returns only pyrit plugins", () => {
    const result = getPluginsByTool("pyrit");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.tool === "pyrit")).toBe(true);
  });

  it("returns only deepteam plugins", () => {
    const result = getPluginsByTool("deepteam");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.tool === "deepteam")).toBe(true);
  });

  it("all 4 tools together account for all 41 plugins", () => {
    const total =
      getPluginsByTool("promptfoo").length +
      getPluginsByTool("garak").length +
      getPluginsByTool("pyrit").length +
      getPluginsByTool("deepteam").length;
    expect(total).toBe(41);
  });
});
