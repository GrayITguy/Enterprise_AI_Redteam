import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { db } from "../../db/index.js";
import { users, inviteCodes } from "../../db/schema.js";
import { eq, and, isNull, gt } from "drizzle-orm";
import { generateToken, requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const authRouter = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  inviteCode: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── POST /api/auth/setup ────────────────────────────────────────────────────
// First-run: create the first admin account. Only works when users table is empty.
authRouter.post("/setup", async (req, res) => {
  try {
    const existingUsers = await db.select({ id: users.id }).from(users).limit(1).all();
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: "Setup already completed. Use /login instead." });
    }

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    const newUser = {
      id: uuid(),
      email,
      passwordHash,
      role: "admin" as const,
      inviteCode: null,
      createdAt: now,
      lastLoginAt: now,
    };

    await db.insert(users).values(newUser);
    const token = generateToken(newUser);

    return res.status(201).json({
      token,
      user: { id: newUser.id, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    return res.status(500).json({ error: "Setup failed" });
  }
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Register with a valid invite code
authRouter.post("/register", async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const { email, password, inviteCode } = parsed.data;

    // Verify invite code exists, is unused, and not expired
    if (!inviteCode) {
      return res.status(400).json({ error: "Invite code required for registration" });
    }

    const invite = await db
      .select()
      .from(inviteCodes)
      .where(
        and(
          eq(inviteCodes.code, inviteCode),
          isNull(inviteCodes.usedBy)
        )
      )
      .get();

    if (!invite) {
      return res.status(400).json({ error: "Invalid or already used invite code" });
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(400).json({ error: "Invite code has expired" });
    }

    // Check email uniqueness
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();

    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const newUser = {
      id: uuid(),
      email,
      passwordHash,
      role: "analyst" as const,
      inviteCode,
      createdAt: now,
      lastLoginAt: now,
    };

    await db.insert(users).values(newUser);

    // Mark invite as used
    await db
      .update(inviteCodes)
      .set({ usedBy: newUser.id })
      .where(eq(inviteCodes.id, invite.id));

    const token = generateToken(newUser);

    return res.status(201).json({
      token,
      user: { id: newUser.id, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    return res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
authRouter.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed" });
    }

    const { email, password } = parsed.data;
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Update last login
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const token = generateToken(user);

    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    return res.status(500).json({ error: "Login failed" });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
authRouter.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
  return res.json(req.user);
});

// ─── POST /api/auth/invite ────────────────────────────────────────────────────
// Admin-only: create invite codes
authRouter.post("/invite", requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const parsed = z
    .object({ expiresInDays: z.number().int().min(1).max(365).optional() })
    .safeParse(req.body);

  const expiresInDays = parsed.success ? parsed.data.expiresInDays : undefined;
  const code = `EART-${uuid().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const now = new Date();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400_000)
    : null;

  await db.insert(inviteCodes).values({
    id: uuid(),
    code,
    createdBy: req.user.id,
    usedBy: null,
    expiresAt,
    createdAt: now,
  });

  return res.status(201).json({ code, expiresAt });
});
