import { Router } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import {
  getSetting,
  setSetting,
  getSettings,
} from "../services/settingsService.js";
import { resolveForHost } from "../utils/resolveEndpoint.js";
import { logger } from "../utils/logger.js";
import { errorMessage, safeJsonParse } from "../utils/helpers.js";
import { testProvider } from "../services/aiProvider.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

// ─── SMTP Settings ──────────────────────────────────────────────────────────

/** GET /api/settings/smtp — admin only (returns config, password redacted) */
settingsRouter.get(
  "/smtp",
  requireRole("admin"),
  async (_req: AuthenticatedRequest, res) => {
    const s = await getSettings("smtp.");
    res.json({
      host: s["smtp.host"] ?? "",
      port: s["smtp.port"] ?? "587",
      secure: s["smtp.secure"] === "true",
      user: s["smtp.user"] ?? "",
      hasPassword: !!s["smtp.password"],
      from: s["smtp.from"] ?? "",
      envConfigured: !!process.env.SMTP_HOST,
    });
  }
);

/** PUT /api/settings/smtp — admin only */
settingsRouter.put(
  "/smtp",
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      host: z.string().min(1, "SMTP host is required"),
      port: z.string().regex(/^\d+$/, "Port must be a number"),
      secure: z.boolean(),
      user: z.string(),
      password: z.string().optional(),
      from: z.string().email("Invalid from address"),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { host, port, secure, user, password, from } = parsed.data;
    const userId = req.user!.id;

    await setSetting("smtp.host", host, userId);
    await setSetting("smtp.port", port, userId);
    await setSetting("smtp.secure", String(secure), userId);
    await setSetting("smtp.user", user, userId);
    if (password !== undefined && password !== "") {
      await setSetting("smtp.password", password, userId);
    }
    await setSetting("smtp.from", from, userId);

    logger.info(`[Settings] SMTP settings updated by ${req.user!.email}`);
    res.json({ message: "SMTP settings saved" });
  }
);

/** POST /api/settings/smtp/test — admin only, send a test email */
settingsRouter.post(
  "/smtp/test",
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({ toEmail: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Provide a valid email address" });
    }

    try {
      const { sendTestEmail } = await import("../services/emailService.js");
      await sendTestEmail(parsed.data.toEmail);
      res.json({ message: "Test email sent successfully" });
    } catch (err) {
      const msg = errorMessage(err);
      logger.error(`[Settings] SMTP test failed: ${msg}`);
      res.status(502).json({ error: msg });
    }
  }
);

// ─── Remediation Settings ───────────────────────────────────────────────────

/** GET /api/settings/remediation — any authenticated user (Remediation page checks this) */
settingsRouter.get(
  "/remediation",
  async (_req: AuthenticatedRequest, res) => {
    const s = await getSettings("remediation.");
    const config = s["remediation.providerConfig"]
      ? safeJsonParse<Record<string, unknown>>(s["remediation.providerConfig"], {})
      : {} as Record<string, unknown>;

    // Redact API key in response
    if (config.apiKey) {
      config.apiKeyHint = "****" + (config.apiKey as string).slice(-4);
      config.hasApiKey = true;
      delete config.apiKey;
    }

    res.json({
      enabled: s["remediation.enabled"] !== "false", // default: enabled
      providerType: s["remediation.providerType"] ?? "project",
      providerConfig: config,
    });
  }
);

/** PUT /api/settings/remediation — admin only */
settingsRouter.put(
  "/remediation",
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      enabled: z.boolean(),
      providerType: z.enum([
        "project",
        "ollama",
        "openai",
        "anthropic",
        "custom",
      ]),
      providerConfig: z
        .object({
          apiKey: z.string().optional(),
          model: z.string().optional(),
          endpoint: z.string().optional(),
        })
        .optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { enabled, providerType, providerConfig } = parsed.data;
    const userId = req.user!.id;

    // Read old provider type BEFORE overwriting so we can detect provider switches
    const oldProviderType = await getSetting("remediation.providerType");

    await setSetting("remediation.enabled", String(enabled), userId);
    await setSetting("remediation.providerType", providerType, userId);

    if (providerConfig) {
      const needsApiKey = ["openai", "anthropic", "custom"].includes(providerType);
      const needsEndpoint = ["ollama", "custom"].includes(providerType);

      // Build clean config with only provider-relevant fields
      const cleanConfig: Record<string, string> = {};
      if (providerConfig.model) cleanConfig.model = providerConfig.model;
      if (needsEndpoint && providerConfig.endpoint) cleanConfig.endpoint = providerConfig.endpoint;

      if (needsApiKey) {
        if (providerConfig.apiKey) {
          cleanConfig.apiKey = providerConfig.apiKey;
        } else if (oldProviderType === providerType) {
          // Only carry over old API key if provider type hasn't changed
          const existing = await getSetting("remediation.providerConfig");
          if (existing) {
            const old = safeJsonParse<Record<string, string>>(existing, {});
            if (old.apiKey) cleanConfig.apiKey = old.apiKey;
          }
        }
      }

      await setSetting(
        "remediation.providerConfig",
        JSON.stringify(cleanConfig),
        userId
      );
    } else {
      // Provider is "project" — clear any stale config
      await setSetting("remediation.providerConfig", JSON.stringify({}), userId);
    }

    logger.info(
      `[Settings] Remediation settings updated by ${req.user!.email}`
    );
    res.json({ message: "Remediation settings saved" });
  }
);

// ─── Test Connection ────────────────────────────────────────────────────────

/** POST /api/settings/remediation/test — test the configured provider with a simple prompt */
settingsRouter.post(
  "/remediation/test",
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      providerType: z.enum(["ollama", "openai", "anthropic", "custom"]),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      endpoint: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { providerType, model, endpoint } = parsed.data;
    let { apiKey } = parsed.data;

    // If no API key provided in request, try to use the saved one
    if (!apiKey) {
      const savedRaw = await getSetting("remediation.providerConfig");
      if (savedRaw) {
        try {
          apiKey = JSON.parse(savedRaw).apiKey;
        } catch {
          /* ignore */
        }
      }
    }

    try {
      const config: Record<string, unknown> = {};
      if (apiKey) config.apiKey = apiKey;
      if (model) config.model = model;
      await testProvider(providerType, config, endpoint);
      return res.json({ success: true });
    } catch (err) {
      const msg = errorMessage(err);
      return res.status(502).json({ success: false, error: msg });
    }
  }
);

// ─── Model Enumeration ──────────────────────────────────────────────────────

/**
 * POST /api/settings/models — list available models for a given provider.
 * Works for Ollama (/api/tags) and OpenAI-compatible (/v1/models) endpoints.
 * Admin only (since it uses potentially-saved API keys).
 */
settingsRouter.post(
  "/models",
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const schema = z.object({
      providerType: z.enum(["ollama", "openai", "anthropic", "custom"]),
      endpoint: z.string().optional(),
      apiKey: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { providerType, endpoint, apiKey } = parsed.data;

    // If no apiKey provided, try to use the saved one from settings
    let effectiveApiKey = apiKey;
    if (!effectiveApiKey) {
      const savedConfig = await getSetting("remediation.providerConfig");
      if (savedConfig) {
        try {
          const cfg = JSON.parse(savedConfig);
          if (cfg.apiKey) effectiveApiKey = cfg.apiKey;
        } catch { /* ignore */ }
      }
    }

    try {
      if (providerType === "ollama") {
        const base = resolveForHost((endpoint || "http://localhost:11434").replace(/\/+$/, ""));
        const resp = await fetch(`${base}/api/tags`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          return res.status(502).json({
            error: `Ollama returned HTTP ${resp.status}`,
            models: [],
          });
        }
        const data = (await resp.json()) as {
          models?: Array<{ name: string; size?: number; modified_at?: string }>;
        };
        const models = (data.models ?? []).map((m) => ({
          id: m.name,
          name: m.name,
        }));
        return res.json({ models });
      }

      if (providerType === "openai" || providerType === "custom") {
        const base = resolveForHost(
          (endpoint || "https://api.openai.com").replace(/\/+$/, "")
        );
        if (!effectiveApiKey && providerType === "openai") {
          return res
            .status(400)
            .json({ error: "API key required for OpenAI", models: [] });
        }
        const headers: Record<string, string> = {
          Accept: "application/json",
        };
        if (effectiveApiKey) {
          headers["Authorization"] = `Bearer ${effectiveApiKey}`;
        }
        const resp = await fetch(`${base}/v1/models`, {
          headers,
          signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) {
          return res.status(502).json({
            error: `Models endpoint returned HTTP ${resp.status}`,
            models: [],
          });
        }
        const data = (await resp.json()) as {
          data?: Array<{ id: string; owned_by?: string }>;
        };
        const models = (data.data ?? []).map((m) => ({
          id: m.id,
          name: m.id,
        }));
        return res.json({ models });
      }

      if (providerType === "anthropic") {
        // Anthropic doesn't have a public model listing endpoint;
        // return the well-known models instead.
        return res.json({
          models: [
            { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
            { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
            { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
          ],
        });
      }

      return res.json({ models: [] });
    } catch (err) {
      const msg = errorMessage(err);
      logger.debug(`[Settings] Model enumeration failed: ${msg}`);
      return res.status(502).json({ error: msg, models: [] });
    }
  }
);
