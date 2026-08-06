import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { projectsRouter } from "./routes/projects.js";
import { scansRouter } from "./routes/scans.js";
import { resultsRouter } from "./routes/results.js";
import { reportsRouter } from "./routes/reports.js";
import { remediationRouter } from "./routes/remediation.js";
import { ollamaRouter } from "./routes/ollama.js";
import { connectivityRouter } from "./routes/connectivity.js";
import { settingsRouter } from "./routes/settings.js";
import { auditRouter } from "./routes/audit.js";
import { retentionRouter } from "./routes/retention.js";
import { scimRouter } from "./routes/scim.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { runMigrations } from "../db/migrate.js";
import { logger } from "./utils/logger.js";
import { startScheduler } from "./services/scheduler.js";
import { apiLimiter, authLimiter } from "./middleware/rateLimiter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // React app needs inline scripts
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const defaultOrigins = process.env.NODE_ENV === "production"
  ? "http://localhost:15500"
  : "http://localhost:5173,http://localhost:3000";
const allowedOrigins = (process.env.CORS_ORIGIN ?? defaultOrigins).split(",").map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Accept application/scim+json (SCIM 2.0) in addition to application/json.
app.use(express.json({ limit: "10mb", type: ["application/json", "application/scim+json", "application/*+json"] }));
app.use(express.urlencoded({ extended: true }));

// ─── Request logging (dev) ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Rate limiters are applied per-router (see each route file) so that CodeQL
// can verify every route handler is protected.  The global application below
// provides defense-in-depth for any routes not covered by a router.
app.use("/api/", apiLimiter);
app.use("/api/auth", authLimiter);

// ─── Health check (no auth) ───────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "2.2.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/scans", scansRouter);
app.use("/api/results", resultsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/remediation", remediationRouter);
app.use("/api/ollama", ollamaRouter);
app.use("/api/connectivity", connectivityRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/retention", retentionRouter);
// SCIM 2.0 provisioning (bearer-token auth via SCIM_TOKEN, not JWT).
app.use("/scim/v2", scimRouter);

// ─── Serve React SPA in production ───────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const siteDir = path.join(__dirname, "../../site/dist");
  app.use(express.static(siteDir));
  // SPA fallback — all non-API routes serve index.html
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(siteDir, "index.html"));
  });
}

// ─── Global error handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Bootstrap ───────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap(): Promise<void> {
  try {
    await runMigrations();
    startScheduler();
    app.listen(PORT, "0.0.0.0", () => {
      logger.info(`Enterprise AI Red Team Platform listening on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV ?? "development"}`);
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Only bootstrap (listen + migrate) when running as the main process, not during tests
if (process.env.NODE_ENV !== "test") {
  bootstrap();
}

export default app;
