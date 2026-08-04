import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db, getRow, getRows } from "../../db/index.js";
import { scans, projects, scanResults } from "../../db/schema.js";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { PLUGINS, PRESETS } from "../config/pluginCatalog.js";
import { scanQueue } from "../services/queue.js";
import { publishCancel } from "../services/scanControl.js";
import { onScanProgress } from "../services/scanProgress.js";
import { safeJsonParse, asyncHandler } from "../utils/helpers.js";
import { OWASP_NAMES } from "../config/constants.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

export const scansRouter = Router();
scansRouter.use(apiLimiter);
scansRouter.use(requireAuth);

const CreateScanSchema = z.object({
  projectId: z.string().uuid(),
  preset: z.enum(["quick", "owasp", "full"]).optional(),
  plugins: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
  recurrence: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
  notifyOn: z.enum(["always", "failure"]).nullable().optional(),
});

// ─── GET /api/scans/catalog ───────────────────────────────────────────────────
scansRouter.get("/catalog", (_req, res) => {
  return res.json({ plugins: PLUGINS, presets: PRESETS });
});

// ─── GET /api/scans/stats ─────────────────────────────────────────────────────
scansRouter.get("/stats", asyncHandler(async (req: AuthenticatedRequest, res) => {
  // Aggregate failed findings by severity across all completed scans for this user
  const rows = await getRows(db
    .select({
      severity: scanResults.severity,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(scanResults)
    .innerJoin(scans, eq(scanResults.scanId, scans.id))
    .where(
      and(
        eq(scans.userId, req.user!.id),
        eq(scans.status, "completed"),
        sql`not ${scanResults.passed}`
      )
    )
    .groupBy(scanResults.severity)
    );

  const stats: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of rows) {
    stats[row.severity] = Number(row.count);
  }
  return res.json(stats);
}));

// ─── GET /api/scans/history ───────────────────────────────────────────────────
// Returns last 30 completed scans for trend charting (oldest first).
scansRouter.get("/history", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const rows = await getRows(db
    .select({
      id: scans.id,
      projectName: projects.name,
      completedAt: scans.completedAt,
      totalTests: scans.totalTests,
      passedTests: scans.passedTests,
      failedTests: scans.failedTests,
    })
    .from(scans)
    .leftJoin(projects, eq(scans.projectId, projects.id))
    .where(and(eq(scans.userId, req.user!.id), eq(scans.status, "completed")))
    .orderBy(desc(scans.completedAt))
    .limit(30)
    );

  // Return oldest-first so charts render left-to-right
  return res.json(rows.reverse());
}));

// ─── GET /api/scans/upcoming ──────────────────────────────────────────────────
// Returns pending scans that are scheduled in the future + recurring scans.
scansRouter.get("/upcoming", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const now = new Date();
  const rows = await getRows(db
    .select({
      id: scans.id,
      projectId: scans.projectId,
      status: scans.status,
      preset: scans.preset,
      scheduledAt: scans.scheduledAt,
      recurrence: scans.recurrence,
      createdAt: scans.createdAt,
      projectName: projects.name,
    })
    .from(scans)
    .leftJoin(projects, eq(scans.projectId, projects.id))
    .where(
      and(
        eq(scans.userId, req.user!.id),
        eq(scans.status, "pending"),
        gte(scans.scheduledAt, now)
      )
    )
    .orderBy(scans.scheduledAt)
    .limit(10)
    );

  return res.json(rows);
}));

// ─── GET /api/scans ───────────────────────────────────────────────────────────
scansRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const rows = await getRows(db
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
      progress: scans.progress,
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
    );

  return res.json(
    rows.map((s) => ({
      ...s,
      plugins: safeJsonParse(s.plugins, []),
    }))
  );
}));

// ─── POST /api/scans ──────────────────────────────────────────────────────────
scansRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = CreateScanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }

  const { projectId, preset, plugins: customPlugins, scheduledAt, recurrence, notifyOn } = parsed.data;

  // Verify project belongs to user
  const project = await getRow(db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, req.user!.id)))
    );

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
    progress: 0,
    errorMessage: null,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    recurrence: recurrence ?? null,
    notifyOn: notifyOn ?? null,
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
}));

// ─── GET /api/scans/:id ───────────────────────────────────────────────────────
scansRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scan = await getRow(db
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
      progress: scans.progress,
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
    );

  if (!scan) {
    return res.status(404).json({ error: "Scan not found" });
  }

  return res.json({
    ...scan,
    plugins: safeJsonParse(scan.plugins, []),
  });
}));

// ─── GET /api/scans/:id/results ───────────────────────────────────────────────
scansRouter.get("/:id/results", asyncHandler(async (req: AuthenticatedRequest, res) => {
  // Verify ownership
  const scan = await getRow(db
    .select({ id: scans.id })
    .from(scans)
    .where(and(eq(scans.id, req.params.id), eq(scans.userId, req.user!.id)))
    );

  if (!scan) {
    return res.status(404).json({ error: "Scan not found" });
  }

  // Pagination — a large Garak run can emit tens of thousands of results, so
  // cap the page size and let the client page through them.
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const totalRow = await getRow(db
    .select({ count: sql<number>`count(*)` })
    .from(scanResults)
    .where(eq(scanResults.scanId, req.params.id))
    );
  const total = Number(totalRow?.count ?? 0);

  const results = await getRows(db
    .select()
    .from(scanResults)
    .where(eq(scanResults.scanId, req.params.id))
    .orderBy(desc(scanResults.createdAt))
    .limit(limit)
    .offset(offset)
    );

  return res.json({
    results: results.map((r) => ({
      ...r,
      evidence: safeJsonParse(r.evidence, {}),
    })),
    total,
    limit,
    offset,
  });
}));

// ─── GET /api/scans/:id/diff?original=<scanId> ────────────────────────────────
// Before/after comparison between a remediation retest (`:id`) and the original
// scan it re-tested, grouped by OWASP category — so a user can see which
// categories were fixed after applying the remediation guidance.
scansRouter.get("/:id/diff", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const originalId = String(req.query.original ?? "");
  if (!originalId) {
    return res.status(400).json({ error: "The 'original' query parameter is required" });
  }

  // Both scans must belong to the requesting user.
  const [retest, original] = await Promise.all([
    getRow(db.select({ id: scans.id, status: scans.status })
      .from(scans)
      .where(and(eq(scans.id, req.params.id), eq(scans.userId, req.user!.id)))
      ),
    getRow(db.select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.id, originalId), eq(scans.userId, req.user!.id)))
      ),
  ]);
  if (!retest || !original) return res.status(404).json({ error: "Scan not found" });

  const failedExpr = sql<number>`sum(case when not ${scanResults.passed} then 1 else 0 end)`;
  const groupByCategory = (scanId: string) =>
    getRows(db.select({ cat: scanResults.owaspCategory, failed: failedExpr })
      .from(scanResults)
      .where(eq(scanResults.scanId, scanId))
      .groupBy(scanResults.owaspCategory)
      );

  const [origRows, retestRows] = await Promise.all([
    groupByCategory(originalId),
    groupByCategory(req.params.id),
  ]);

  const retestFailedByCat = new Map<string, number>(
    retestRows.map((r) => [r.cat ?? "Other", Number(r.failed)])
  );

  const categories: Array<{
    category: string; name: string; beforeFailed: number;
    afterFailed: number | null; status: "fixed" | "improved" | "unchanged" | "not-retested";
  }> = [];
  for (const r of origRows) {
    const beforeFailed = Number(r.failed);
    if (beforeFailed === 0) continue; // only categories that originally failed
    const cat = r.cat ?? "Other";
    const afterFailed = retestFailedByCat.has(cat) ? retestFailedByCat.get(cat)! : null;
    const status =
      afterFailed == null ? "not-retested"
        : afterFailed === 0 ? "fixed"
        : afterFailed < beforeFailed ? "improved"
        : "unchanged";
    categories.push({ category: cat, name: OWASP_NAMES[cat] ?? cat, beforeFailed, afterFailed, status });
  }

  const summary = {
    fixed: categories.filter((c) => c.status === "fixed").length,
    improved: categories.filter((c) => c.status === "improved").length,
    unchanged: categories.filter((c) => c.status === "unchanged").length,
    beforeFailed: categories.reduce((n, c) => n + c.beforeFailed, 0),
    afterFailed: categories.reduce((n, c) => n + (c.afterFailed ?? c.beforeFailed), 0),
    retestStatus: retest.status,
  };

  return res.json({ originalScanId: originalId, retestScanId: req.params.id, categories, summary });
}));

// ─── GET /api/scans/:id/events ────────────────────────────────────────────────
// Server-Sent Events stream of live progress for a running scan. Emits an
// initial snapshot, then a `progress` event on each worker update, and closes
// after a terminal status. The browser reads this with fetch (bearer auth) and
// falls back to polling if the stream drops.
scansRouter.get("/:id/events", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scan = await getRow(db
    .select({
      id: scans.id, status: scans.status, progress: scans.progress,
      totalTests: scans.totalTests, passedTests: scans.passedTests, failedTests: scans.failedTests,
    })
    .from(scans)
    .where(and(eq(scans.id, req.params.id), eq(scans.userId, req.user!.id)))
    );
  if (!scan) return res.status(404).json({ error: "Scan not found" });

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx)
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Initial snapshot so the client renders immediately.
  send("progress", scan);
  const terminal = ["completed", "failed", "cancelled"];
  if (terminal.includes(scan.status)) {
    send("done", { status: scan.status });
    return res.end();
  }

  // Heartbeat keeps the connection alive through idle periods / proxies.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
  let unsubscribe = () => {};
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  unsubscribe = onScanProgress(req.params.id, (evt) => {
    send("progress", evt);
    if (terminal.includes(evt.status)) {
      send("done", { status: evt.status });
      cleanup();
      res.end();
    }
  });

  req.on("close", cleanup);
  return undefined;
}));

// ─── POST /api/scans/:id/cancel ───────────────────────────────────────────────
scansRouter.post("/:id/cancel", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const scan = await getRow(db
    .select({ id: scans.id, status: scans.status })
    .from(scans)
    .where(and(eq(scans.id, req.params.id), eq(scans.userId, req.user!.id)))
    );

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

  // Notify the worker (any replica) to abort a running scan promptly. Best-effort
  // on top of the durable status write above.
  await publishCancel(scan.id);

  return res.json({ message: "Scan cancelled" });
}));
