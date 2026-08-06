import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { userHasPermission } from "../services/permissionService.js";
import type { PermissionId } from "../config/permissions.js";

export interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: {
    id: string;
    email: string;
    role: "admin" | "analyst" | "viewer";
    /** Optional custom role granting extra fine-grained permissions. */
    customRoleId?: string | null;
  };
}

const isDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
if (!process.env.JWT_SECRET && !isDev) {
  throw new Error(
    "JWT_SECRET environment variable is required. " +
    "Set NODE_ENV=development to use a dev-only fallback."
  );
}
const jwtSecret = process.env.JWT_SECRET ?? "dev-secret-change-me";

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as {
      sub: string;
      email: string;
      role: "admin" | "analyst" | "viewer";
      customRoleId?: string | null;
    };
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      customRoleId: payload.customRoleId ?? null,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

const ROLE_ORDER: Record<string, number> = {
  viewer: 0,
  analyst: 1,
  admin: 2,
};

export function requireRole(minRole: "viewer" | "analyst" | "admin") {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    const userLevel = ROLE_ORDER[req.user?.role ?? ""] ?? -1;
    const requiredLevel = ROLE_ORDER[minRole] ?? 99;

    if (userLevel < requiredLevel) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Require a specific fine-grained permission. Admins always pass; other users
 * pass when their base tier or assigned custom role grants the permission.
 * Assigning a custom role takes effect on the user's next login (the id is
 * carried in the JWT); editing a role's permission set takes effect within the
 * permission cache TTL.
 */
export function requirePermission(permission: PermissionId) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const ok = await userHasPermission(
        { role: req.user.role, customRoleId: req.user.customRoleId },
        permission
      );
      if (!ok) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "Permission check failed" });
    }
  };
}

export function generateToken(user: {
  id: string;
  email: string;
  role: string;
  customRoleId?: string | null;
}): string {
  return jwt.sign(
    { email: user.email, role: user.role, customRoleId: user.customRoleId ?? null },
    jwtSecret,
    {
      subject: user.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as any,
    }
  );
}
