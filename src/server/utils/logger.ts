import winston from "winston";
import fs from "fs";

const logsDir = "./logs";
fs.mkdirSync(logsDir, { recursive: true });

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === "production"
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(
            ({ level, message, timestamp, ...meta }) => {
              const metaStr = Object.keys(meta).length
                ? " " + JSON.stringify(meta)
                : "";
              return `${timestamp} ${level}: ${message}${metaStr}`;
            }
          )
        )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 10_000_000,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 10_000_000,
      maxFiles: 10,
    }),
  ],
});
