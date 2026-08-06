import { Router } from "express";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../utils/helpers.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { retentionConfig, purgeExpiredData } from "../services/retentionService.js";

export const retentionRouter = Router();
retentionRouter.use(apiLimiter);
retentionRouter.use(requireAuth);
retentionRouter.use(requireRole("admin")); // data governance is admin-only

// ─── GET /api/retention ───────────────────────────────────────────────────────
// Current retention configuration (from env).
retentionRouter.get("/", (_req, res) => {
  return res.json(retentionConfig());
});

// ─── POST /api/retention/purge ────────────────────────────────────────────────
// Run the retention purge now (in addition to the daily schedule).
retentionRouter.post("/purge", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const result = await purgeExpiredData({ userId: req.user!.id, userEmail: req.user!.email });
  return res.json({ purged: result, config: retentionConfig() });
}));
