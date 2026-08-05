import { pgTable, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL mirror of schema.sqlite.ts.
//
// Same table names, same (snake_case) column names, same enums, same
// nullability/defaults and foreign keys. Type mapping vs. the SQLite schema:
//   sqlite text                                → pg text
//   sqlite integer(.., { mode: "timestamp" })  → pg timestamp({ withTimezone: true, mode: "date" })
//   sqlite integer(.., { mode: "boolean" })    → pg boolean
//   sqlite integer                             → pg integer
//   sqlite text(., { enum: [...] })            → pg text(., { enum: [...] })  (kept as text+enum,
//                                                 no native pg enum types)
// ─────────────────────────────────────────────────────────────────────────────

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "analyst", "viewer"] })
    .default("analyst")
    .notNull(),
  inviteCode: text("invite_code"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
});

// ─── Invite codes ────────────────────────────────────────────────────────────
export const inviteCodes = pgTable("invite_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  usedBy: text("used_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// ─── Projects ────────────────────────────────────────────────────────────────
export const projects = pgTable("projects", {
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
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

// ─── Scans ───────────────────────────────────────────────────────────────────
export const scans = pgTable("scans", {
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
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }),
  /** null = run-once; "daily" | "weekly" | "monthly" = recurring */
  recurrence: text("recurrence"),
  /** "always" = every completion; "failure" = only when failedTests > 0; null = no email */
  notifyOn: text("notify_on"),
  /** 0-100 progress percentage, updated in real-time during scan execution */
  progress: integer("progress").default(0).notNull(),
  runMetadata: text("run_metadata"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// ─── Scan Results (individual test findings) ─────────────────────────────────
export const scanResults = pgTable("scan_results", {
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
  passed: boolean("passed").notNull(),
  /** JSON object with tool-specific evidence */
  evidence: text("evidence").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// ─── Reports (generated PDF/JSON files) ──────────────────────────────────────
export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  scanId: text("scan_id")
    .notNull()
    .references(() => scans.id),
  format: text("format", { enum: ["pdf", "json", "html", "csv"] }).notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

// ─── App Settings (key-value platform configuration) ─────────────────────────
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedBy: text("updated_by").references(() => users.id),
});

// ─── Audit Log (append-only security/compliance trail) ───────────────────────
export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  userEmail: text("user_email"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  detail: text("detail"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});
