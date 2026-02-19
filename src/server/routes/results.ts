import { Router } from "express";
import { db } from "../../db/index.js";
import { scanResults, scans } from "../../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

// ─── GET /api/results/scans/:scanId/summary ───────────────────────────────────
resultsRouter.get("/scans/:scanId/summary", async (req: AuthenticatedRequest, res) => {
  const scan = await db
    .select({ id: scans.id })
    .from(scans)
    .where(and(eq(scans.id, req.params.scanId), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) return res.status(404).json({ error: "Scan not found" });

  const results = await db
    .select()
    .from(scanResults)
    .where(eq(scanResults.scanId, req.params.scanId))
    .all();

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    bySeverity: {
      critical: results.filter((r) => r.severity === "critical" && !r.passed).length,
      high: results.filter((r) => r.severity === "high" && !r.passed).length,
      medium: results.filter((r) => r.severity === "medium" && !r.passed).length,
      low: results.filter((r) => r.severity === "low" && !r.passed).length,
      info: results.filter((r) => r.severity === "info").length,
    },
    byTool: (["promptfoo", "garak", "pyrit", "deepteam"] as const).reduce(
      (acc, tool) => {
        const toolResults = results.filter((r) => r.tool === tool);
        acc[tool] = {
          total: toolResults.length,
          failed: toolResults.filter((r) => !r.passed).length,
        };
        return acc;
      },
      {} as Record<string, { total: number; failed: number }>
    ),
    byOwaspCategory: results.reduce(
      (acc, r) => {
        const cat = r.owaspCategory ?? "Other";
        if (!acc[cat]) acc[cat] = { total: 0, failed: 0 };
        acc[cat].total++;
        if (!r.passed) acc[cat].failed++;
        return acc;
      },
      {} as Record<string, { total: number; failed: number }>
    ),
  };

  return res.json(summary);
});
