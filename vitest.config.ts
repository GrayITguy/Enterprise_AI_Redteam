import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    env: {
      DATABASE_URL: ":memory:",
      NODE_ENV: "test",
      JWT_SECRET: "test-secret-32-chars-minimum-here",
      REDIS_URL: "redis://localhost:6379",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/db/migrate.ts",
        "src/**/*.test.ts",
        "src/__tests__/**",
        "src/server/workers/scanWorker.ts",
      ],
    },
    // Run tests serially to avoid SQLite file conflicts
    pool: "forks",
    maxWorkers: 1,
  },
});
