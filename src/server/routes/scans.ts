import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../../db/index.js";
import { scans, projects, scanResults } from "../../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { PLUGINS, PRESETS } from "../config/pluginCatalog.js";
import { scanQueue } from "../services/queue.js";

export const scansRouter = Router();
scansRouter.use(requireAuth);

const CreateScanSchema = z.object({
  projectId: z.string().uuid(),
  preset: z.enum(["quick", "owasp", "full"]).optional(),
  plugins: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
});

// ─── GET /api/scans/catalog ───────────────────────────────────────────────────
scansRouter.get("/catalog", (_req, res) => {
  return res.json({ plugins: PLUGINS, presets: PRESETS });
});

// ─── GET /api/scans ───────────────────────────────────────────────────────────
scansRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const rows = await db
    .select({
      id: scans.id,
      projectId: scans.projectId,
      userId: scans.userId,
      status: scans.status,
      preset: scans.preset,
      plugins: scans.plugins,
      totalTests: scans.totalTests,
      passedTests: scans.passedTests,
      failedTests: scans.failedTests,
      startedAt: scans.startedAt,
      completedAt: scans.completedAt,
      createdAt: scans.createdAt,
      projectName: projects.name,
    })
    .from(scans)
    .leftJoin(projects, eq(scans.projectId, projects.id))
    .where(eq(scans.userId, req.user!.id))
    .orderBy(desc(scans.createdAt))
    .limit(100)
    .all();

  return res.json(
    rows.map((s) => ({
      ...s,
      plugins: JSON.parse(s.plugins),
    }))
  );
});

// ─── POST /api/scans ──────────────────────────────────────────────────────────
scansRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = CreateScanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }

  const { projectId, preset, plugins: customPlugins, scheduledAt } = parsed.data;

  // Verify project belongs to user
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, req.user!.id)))
    .get();

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // Resolve plugin list
  let pluginIds: string[];
  if (preset && PRESETS[preset]) {
    pluginIds = PRESETS[preset].plugins;
  } else if (customPlugins && customPlugins.length > 0) {
    // Validate all plugin IDs exist
    const validIds = new Set(PLUGINS.map((p) => p.id));
    const invalid = customPlugins.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Unknown plugin IDs: ${invalid.join(", ")}` });
    }
    pluginIds = customPlugins;
  } else {
    return res.status(400).json({ error: "Either preset or plugins array is required" });
  }

  const now = new Date();
  const newScan = {
    id: uuid(),
    projectId,
    userId: req.user!.id,
    status: "pending" as const,
    preset: preset ?? null,
    plugins: JSON.stringify(pluginIds),
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    errorMessage: null,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
  };

  await db.insert(scans).values(newScan);

  // Enqueue for immediate execution (or let scheduler pick it up if scheduledAt is set)
  if (!scheduledAt) {
    await scanQueue.add("run-scan", { scanId: newScan.id }, { jobId: newScan.id });
  }

  return res.status(201).json({
    ...newScan,
    plugins: pluginIds,
  });
});

// ─── GET /api/scans/:id ───────────────────────────────────────────────────────
scansRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const scan = await db
    .select({
      id: scans.id,
      projectId: scans.projectId,
      userId: scans.userId,
      status: scans.status,
      preset: scans.preset,
      plugins: scans.plugins,
      totalTests: scans.totalTests,
      passedTests: scans.passedTests,
      failedTests: scans.failedTests,
      errorMessage: scans.errorMessage,
      startedAt: scans.startedAt,
      completedAt: scans.completedAt,
      createdAt: scans.createdAt,
      projectName: projects.name,
      projectTargetUrl: projects.targetUrl,
    })
    .from(scans)
    .leftJoin(projects, eq(scans.projectId, projects.id))
    .where(and(eq(scans.id, req.params.id), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) {
    return res.status(404).json({ error: "Scan not found" });
  }

  return res.json({
    ...scan,
    plugins: JSON.parse(scan.plugins),
  });
});

// ─── GET /api/scans/:id/results ───────────────────────────────────────────────
scansRouter.get("/:id/results", async (req: AuthenticatedRequest, res) => {
  // Verify ownership
  const scan = await db
    .select({ id: scans.id })
    .from(scans)
    .where(and(eq(scans.id, req.params.id), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) {
    return res.status(404).json({ error: "Scan not found" });
  }

  const results = await db
    .select()
    .from(scanResults)
    .where(eq(scanResults.scanId, req.params.id))
    .orderBy(desc(scanResults.createdAt))
    .all();

  return res.json(
    results.map((r) => ({
      ...r,
      evidence: JSON.parse(r.evidence),
    }))
  );
});

// ─── POST /api/scans/:id/cancel ───────────────────────────────────────────────
scansRouter.post("/:id/cancel", async (req: AuthenticatedRequest, res) => {
  const scan = await db
    .select({ id: scans.id, status: scans.status })
    .from(scans)
    .where(and(eq(scans.id, req.params.id), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) {
    return res.status(404).json({ error: "Scan not found" });
  }

  if (!["pending", "running"].includes(scan.status)) {
    return res.status(409).json({ error: `Cannot cancel scan with status '${scan.status}'` });
  }

  // Try to remove from queue if still pending
  try {
    const job = await scanQueue.getJob(scan.id);
    if (job) await job.remove();
  } catch {
    // Job may already be running — mark as cancelled anyway
  }

  await db
    .update(scans)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(scans.id, scan.id));

  return res.json({ message: "Scan cancelled" });
});
