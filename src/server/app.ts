import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { scansRouter } from "./routes/scans.js";
import { resultsRouter } from "./routes/results.js";
import { reportsRouter } from "./routes/reports.js";
import { remediationRouter } from "./routes/remediation.js";
import { licenseRouter } from "./routes/license.js";
import { ollamaRouter } from "./routes/ollama.js";
import { connectivityRouter } from "./routes/connectivity.js";
import { settingsRouter } from "./routes/settings.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { runMigrations } from "../db/migrate.js";
import { logger } from "./utils/logger.js";
import { startScheduler } from "./services/scheduler.js";

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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Request logging (dev) ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // stricter for auth endpoints
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
});

// Apply rate limiting globally (covers API and SPA fallback routes)
app.use(apiLimiter);
// Stricter limits on auth endpoints
app.use("/api/auth", authLimiter);

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
app.use("/api/ollama", ollamaRouter);
app.use("/api/connectivity", connectivityRouter);
app.use("/api/settings", settingsRouter);

// ─── Serve React SPA in production ───────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const siteDir = path.join(__dirname, "../../site/dist");
  app.use(express.static(siteDir));
  // SPA fallback — all non-API routes serve index.html
  app.get("*", (req, res, next) => {
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
