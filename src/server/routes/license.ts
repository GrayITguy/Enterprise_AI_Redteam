import { Router } from "express";
import { z } from "zod";
import { LicenseValidator } from "../../license-validator.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";

export const licenseRouter = Router();

// ─── GET /api/license ─────────────────────────────────────────────────────────
// Public endpoint — the setup wizard checks this before requiring login
licenseRouter.get("/", async (_req, res) => {
  try {
    const status = await LicenseValidator.getStatus();
    return res.json(status);
  } catch {
    return res.status(500).json({ error: "Failed to retrieve license status" });
  }
});

// ─── POST /api/license/activate ───────────────────────────────────────────────
licenseRouter.post(
  "/activate",
  requireAuth,
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({ licenseKey: z.string().min(10) })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "License key is required" });
    }

    try {
      const payload = await LicenseValidator.activate(parsed.data.licenseKey);
      return res.json({
        message: "License activated successfully",
        email: payload.email,
        seats: payload.seats,
        features: payload.features,
        expiresAt: payload.expiresAt,
      });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : "Activation failed",
      });
    }
  }
);
