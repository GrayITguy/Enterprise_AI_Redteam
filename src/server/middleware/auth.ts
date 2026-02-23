import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: "admin" | "analyst" | "viewer";
  };
}

if (!process.env.jwtSecret && process.env.NODE_ENV === "production") {
  throw new Error("jwtSecret environment variable is required in production");
}
const jwtSecret = process.env.jwtSecret ?? "dev-secret-change-me";

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
    };
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
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

export function generateToken(user: {
  id: string;
  email: string;
  role: string;
}): string {
  return jwt.sign(
    { email: user.email, role: user.role },
    jwtSecret,
    {
      subject: user.id,
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as string,
    }
  );
}
