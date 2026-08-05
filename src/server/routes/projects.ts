import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db, getRow, getRows } from "../../db/index.js";
import { projects, scans } from "../../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  safeJsonParse,
  asyncHandler,
  redactProviderConfig,
  mergeProviderSecrets,
} from "../utils/helpers.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import {
  assertTargetAuthorized,
  BlockedTargetError,
  UnauthorizedTargetError,
} from "../utils/urlValidation.js";

/**
 * Returns an error string if the target host is blocked (SSRF) or not in the
 * configured authorization allow-list, else null. Kept as a helper so both
 * create and update return a clean 403 without leaking a stack trace.
 */
function checkTargetAuthorized(targetUrl: string): string | null {
  try {
    assertTargetAuthorized(targetUrl);
    return null;
  } catch (err) {
    if (err instanceof UnauthorizedTargetError || err instanceof BlockedTargetError) {
      return err.message;
    }
    throw err;
  }
}

export const projectsRouter = Router();
projectsRouter.use(apiLimiter);
projectsRouter.use(requireAuth);

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  targetUrl: z.string().url(),
  providerType: z.enum(["ollama", "openai", "anthropic", "custom"]),
  providerConfig: z.record(z.string(), z.unknown()).optional().default({}),
});

const UpdateProjectSchema = CreateProjectSchema.partial();

// ─── GET /api/projects ────────────────────────────────────────────────────────
projectsRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const rows = await getRows(db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.userId, req.user!.id),
        eq(projects.isArchived, false)
      )
    )
    .orderBy(desc(projects.createdAt))
    );

  return res.json(
    rows.map((p) => ({
      ...p,
      providerConfig: redactProviderConfig(safeJsonParse(p.providerConfig, {})),
    }))
  );
}));

// ─── POST /api/projects ───────────────────────────────────────────────────────
projectsRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }

  const authError = checkTargetAuthorized(parsed.data.targetUrl);
  if (authError) return res.status(403).json({ error: authError });

  const now = new Date();
  const newProject = {
    id: uuid(),
    userId: req.user!.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    targetUrl: parsed.data.targetUrl,
    providerType: parsed.data.providerType,
    providerConfig: JSON.stringify(parsed.data.providerConfig),
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(projects).values(newProject);

  return res.status(201).json({
    ...newProject,
    providerConfig: redactProviderConfig(parsed.data.providerConfig),
  });
}));

// ─── GET /api/projects/:id ────────────────────────────────────────────────────
projectsRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const project = await getRow(db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, req.params.id), eq(projects.userId, req.user!.id))
    )
    );

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // Include recent scan count
  const scanRows = await getRows(db
    .select({ id: scans.id, status: scans.status, createdAt: scans.createdAt })
    .from(scans)
    .where(eq(scans.projectId, project.id))
    .orderBy(desc(scans.createdAt))
    .limit(5)
    );

  return res.json({
    ...project,
    providerConfig: redactProviderConfig(safeJsonParse(project.providerConfig, {})),
    recentScans: scanRows,
  });
}));

// ─── PATCH /api/projects/:id ──────────────────────────────────────────────────
projectsRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const project = await getRow(db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, req.params.id), eq(projects.userId, req.user!.id))
    )
    );

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const parsed = UpdateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }

  const updates: Partial<typeof projects.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (parsed.data.targetUrl !== undefined) {
    const authError = checkTargetAuthorized(parsed.data.targetUrl);
    if (authError) return res.status(403).json({ error: authError });
  }

  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
  if (parsed.data.targetUrl !== undefined) updates.targetUrl = parsed.data.targetUrl;
  if (parsed.data.providerType !== undefined) updates.providerType = parsed.data.providerType;
  if (parsed.data.providerConfig !== undefined) {
    // Preserve a stored apiKey/secret when the client saves without re-sending
    // it (the redacted GET response never exposes it to begin with).
    const storedConfig = safeJsonParse<Record<string, unknown>>(project.providerConfig, {});
    const merged = mergeProviderSecrets(parsed.data.providerConfig, storedConfig);
    updates.providerConfig = JSON.stringify(merged);
  }

  await db.update(projects).set(updates).where(eq(projects.id, req.params.id));

  const updated = await getRow(db
    .select()
    .from(projects)
    .where(eq(projects.id, req.params.id))
    );

  return res.json({
    ...updated,
    providerConfig: redactProviderConfig(safeJsonParse(updated!.providerConfig, {})),
  });
}));

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
// Soft delete — sets isArchived = true to preserve scan history
projectsRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const project = await getRow(db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, req.params.id), eq(projects.userId, req.user!.id))
    )
    );

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  await db
    .update(projects)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(eq(projects.id, req.params.id));

  return res.status(204).send();
}));
