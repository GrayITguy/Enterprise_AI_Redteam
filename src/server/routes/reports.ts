import { Router } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { db } from "../../db/index.js";
import { reports, scans } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { ReportGenerator } from "../services/reportGenerator.js";
import { asyncHandler } from "../utils/helpers.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

export const reportsRouter = Router();
reportsRouter.use(apiLimiter);
reportsRouter.use(requireAuth);

const generator = new ReportGenerator();

// ─── GET /api/reports/:scanId ─────────────────────────────────────────────────
reportsRouter.get("/:scanId", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scan = await db
    .select({ id: scans.id })
    .from(scans)
    .where(and(eq(scans.id, req.params.scanId), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) return res.status(404).json({ error: "Scan not found" });

  const existing = await db
    .select()
    .from(reports)
    .where(eq(reports.scanId, req.params.scanId))
    .all();

  return res.json(existing);
}));

// ─── POST /api/reports/:scanId/generate ──────────────────────────────────────
reportsRouter.post("/:scanId/generate", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = z
    .object({ format: z.enum(["pdf", "json"]).default("pdf") })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed" });
  }

  const scan = await db
    .select({ id: scans.id, status: scans.status })
    .from(scans)
    .where(and(eq(scans.id, req.params.scanId), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) return res.status(404).json({ error: "Scan not found" });

  if (scan.status !== "completed") {
    return res.status(409).json({
      error: "Scan must be completed before generating a report",
      status: scan.status,
    });
  }

  try {
    const { format } = parsed.data;
    const reportId =
      format === "pdf"
        ? await generator.generatePDF(scan.id)
        : await generator.generateJSON(scan.id);

    return res.status(201).json({ reportId, format });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report generation failed";
    return res.status(500).json({ error: message });
  }
}));

// ─── GET /api/reports/:scanId/download/:reportId ──────────────────────────────
reportsRouter.get(
  "/:scanId/download/:reportId",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const report = await db
      .select({
        id: reports.id,
        scanId: reports.scanId,
        format: reports.format,
        filePath: reports.filePath,
      })
      .from(reports)
      .where(eq(reports.id, req.params.reportId))
      .get();

    if (!report) return res.status(404).json({ error: "Report not found" });

    // Verify the parent scan belongs to the requesting user
    const scan = await db
      .select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.id, report.scanId), eq(scans.userId, req.user!.id)))
      .get();

    if (!scan) return res.status(404).json({ error: "Report not found" });

    // Validate report file path is within the expected report directory
    const reportDir = path.resolve(process.env.REPORT_DIR ?? "./data/reports");
    const resolvedPath = path.resolve(report.filePath);
    if (!resolvedPath.startsWith(reportDir)) {
      return res.status(403).json({ error: "Invalid report file path" });
    }

    if (!fs.existsSync(report.filePath)) {
      return res.status(404).json({ error: "Report file not found on disk" });
    }

    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      json: "application/json",
      html: "text/html",
      csv: "text/csv",
    };

    res.setHeader("Content-Type", mimeTypes[report.format] ?? "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="eart-report-${req.params.scanId.slice(0, 8)}.${report.format}"`
    );

    fs.createReadStream(report.filePath).pipe(res);
  })
);
