import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: "admin" | "analyst" | "viewer";
  };
}

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

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
    const payload = jwt.verify(token, JWT_SECRET) as {
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
    JWT_SECRET,
    {
      subject: user.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as any,
    }
  );
}
