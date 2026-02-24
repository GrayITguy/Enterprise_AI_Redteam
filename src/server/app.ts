import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { scansRouter } from "./routes/scans.js";
import { resultsRouter } from "./routes/results.js";
import { reportsRouter } from "./routes/reports.js";
import { remediationRouter } from "./routes/remediation.js";
import { licenseRouter } from "./routes/license.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { runMigrations } from "../db/migrate.js";
import { logger } from "./utils/logger.js";
import { startScheduler } from "./services/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // React app needs inline scripts
    crossOriginEmbedderPolicy: false,
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN ?? "*").split(",").map((s) => s.trim());
const isWildcardOrigin = allowedOrigins.includes("*");
app.use(
  cors({
    origin: isWildcardOrigin ? "*" : allowedOrigins,
    credentials: !isWildcardOrigin, // credentials cannot be used with wildcard origin
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Request logging (dev) ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });
}

// ─── Health check (no auth) ───────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/scans", scansRouter);
app.use("/api/results", resultsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/remediation", remediationRouter);
app.use("/api/license", licenseRouter);

// ─── Serve React SPA in production ───────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const siteDir = path.join(__dirname, "../../site/dist");
  app.use(express.static(siteDir));
  // SPA fallback — all non-API routes serve index.html
  app.get(/^(?!\/api).*/, (_req, res) => {
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
