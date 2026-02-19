import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "analyst", "viewer"] })
    .default("analyst")
    .notNull(),
  inviteCode: text("invite_code"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Invite codes
// ─────────────────────────────────────────────────────────────────────────────
export const inviteCodes = sqliteTable("invite_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  usedBy: text("used_by").references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────────────
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  targetUrl: text("target_url").notNull(),
  providerType: text("provider_type", {
    enum: ["ollama", "openai", "anthropic", "custom"],
  }).notNull(),
  /** JSON: { model, apiKey, systemPrompt, headers, ... } */
  providerConfig: text("provider_config").notNull().default("{}"),
  isArchived: integer("is_archived", { mode: "boolean" })
    .default(false)
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Scans
// ─────────────────────────────────────────────────────────────────────────────
export const scans = sqliteTable("scans", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed", "cancelled"],
  })
    .default("pending")
    .notNull(),
  /** "quick" | "owasp" | "full" | null (custom) */
  preset: text("preset"),
  /** JSON array of plugin IDs */
  plugins: text("plugins").notNull().default("[]"),
  totalTests: integer("total_tests").default(0).notNull(),
  passedTests: integer("passed_tests").default(0).notNull(),
  failedTests: integer("failed_tests").default(0).notNull(),
  errorMessage: text("error_message"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Scan Results (individual test findings)
// ─────────────────────────────────────────────────────────────────────────────
export const scanResults = sqliteTable("scan_results", {
  id: text("id").primaryKey(),
  scanId: text("scan_id")
    .notNull()
    .references(() => scans.id),
  tool: text("tool", { enum: ["promptfoo", "garak", "pyrit", "deepteam"] }).notNull(),
  category: text("category").notNull(),
  severity: text("severity", {
    enum: ["critical", "high", "medium", "low", "info"],
  }).notNull(),
  testName: text("test_name").notNull(),
  /** "LLM01" through "LLM10" or null */
  owaspCategory: text("owasp_category"),
  prompt: text("prompt"),
  response: text("response"),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  /** JSON object with tool-specific evidence */
  evidence: text("evidence").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Reports (generated PDF/JSON files)
// ─────────────────────────────────────────────────────────────────────────────
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  scanId: text("scan_id")
    .notNull()
    .references(() => scans.id),
  format: text("format", { enum: ["pdf", "json", "html", "csv"] }).notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// License Keys
// ─────────────────────────────────────────────────────────────────────────────
export const licenseKeys = sqliteTable("license_keys", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  email: text("email"),
  seats: integer("seats").default(1).notNull(),
  /** JSON array of feature flags */
  features: text("features").notNull().default("[]"),
  machineId: text("machine_id"),
  activatedAt: integer("activated_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});
