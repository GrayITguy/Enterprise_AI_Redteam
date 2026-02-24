import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { logger } from "../utils/logger.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisConnection.on("error", (err: Error) => {
  logger.error("Redis connection error:", err.message);
});

redisConnection.on("connect", () => {
  logger.info("Redis connected");
});

export const scanQueue = new Queue("scans", {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 10_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

export interface ScanJobData {
  scanId: string;
}
