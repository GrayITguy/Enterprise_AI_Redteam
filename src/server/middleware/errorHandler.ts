import type { ErrorRequestHandler } from "express";
import { logger } from "../utils/logger.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error(`Unhandled error on ${req.method} ${req.path}: ${err.message}`, {
    stack: err.stack,
  });

  if (res.headersSent) return;

  res.status(500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
}
