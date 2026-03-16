import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { db } from "../../db/index.js";
import { projects, scans } from "../../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { safeJsonParse, asyncHandler } from "../utils/helpers.js";

export const projectsRouter = Router();
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
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.userId, req.user!.id),
        eq(projects.isArchived, false)
      )
    )
    .orderBy(desc(projects.createdAt))
    .all();

  return res.json(
    rows.map((p) => ({
      ...p,
      providerConfig: safeJsonParse(p.providerConfig, {}),
    }))
  );
}));

// ─── POST /api/projects ───────────────────────────────────────────────────────
projectsRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }

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
    providerConfig: parsed.data.providerConfig,
  });
}));

// ─── GET /api/projects/:id ────────────────────────────────────────────────────
projectsRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const project = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, req.params.id), eq(projects.userId, req.user!.id))
    )
    .get();

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // Include recent scan count
  const scanRows = await db
    .select({ id: scans.id, status: scans.status, createdAt: scans.createdAt })
    .from(scans)
    .where(eq(scans.projectId, project.id))
    .orderBy(desc(scans.createdAt))
    .limit(5)
    .all();

  return res.json({
    ...project,
    providerConfig: safeJsonParse(project.providerConfig, {}),
    recentScans: scanRows,
  });
}));

// ─── PATCH /api/projects/:id ──────────────────────────────────────────────────
projectsRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, req.params.id), eq(projects.userId, req.user!.id))
    )
    .get();

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

  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
  if (parsed.data.targetUrl !== undefined) updates.targetUrl = parsed.data.targetUrl;
  if (parsed.data.providerType !== undefined) updates.providerType = parsed.data.providerType;
  if (parsed.data.providerConfig !== undefined) {
    updates.providerConfig = JSON.stringify(parsed.data.providerConfig);
  }

  await db.update(projects).set(updates).where(eq(projects.id, req.params.id));

  const updated = await db
    .select()
    .from(projects)
    .where(eq(projects.id, req.params.id))
    .get();

  return res.json({
    ...updated,
    providerConfig: safeJsonParse(updated!.providerConfig, {}),
  });
}));

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
// Soft delete — sets isArchived = true to preserve scan history
projectsRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, req.params.id), eq(projects.userId, req.user!.id))
    )
    .get();

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  await db
    .update(projects)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(eq(projects.id, req.params.id));

  return res.status(204).send();
}));
