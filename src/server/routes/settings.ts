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
import { logger } from "../utils/logger.js";

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
      const msg = err instanceof Error ? err.message : String(err);
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
      ? JSON.parse(s["remediation.providerConfig"])
      : {};

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

    await setSetting("remediation.enabled", String(enabled), userId);
    await setSetting("remediation.providerType", providerType, userId);
    if (providerConfig) {
      // If no new apiKey provided, preserve existing one
      if (
        providerConfig.apiKey === undefined ||
        providerConfig.apiKey === ""
      ) {
        const existing = await getSetting("remediation.providerConfig");
        if (existing) {
          const old = JSON.parse(existing);
          if (old.apiKey) {
            providerConfig.apiKey = old.apiKey;
          }
        }
      }
      await setSetting(
        "remediation.providerConfig",
        JSON.stringify(providerConfig),
        userId
      );
    }

    logger.info(
      `[Settings] Remediation settings updated by ${req.user!.email}`
    );
    res.json({ message: "Remediation settings saved" });
  }
);
