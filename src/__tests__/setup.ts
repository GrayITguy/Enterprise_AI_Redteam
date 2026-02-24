/**
 * Global test setup — runs before every test file.
 * Environment variables (DATABASE_URL, NODE_ENV, JWT_SECRET) are already
 * set via vitest.config.ts `env` block, which runs before any module is imported.
 */

// Suppress info/debug logs during tests to keep output clean
process.env.LOG_LEVEL = "error";
