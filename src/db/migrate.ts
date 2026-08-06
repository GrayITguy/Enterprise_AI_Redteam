import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite, pgClient, isPostgres } from "./index.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  if (isPostgres) {
    await applyPostgresSchema();
    return;
  }

  const migrationsFolder = path.join(__dirname, "migrations");
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const hasMigrations = fs.existsSync(journalPath);

  if (!hasMigrations) {
    // No migration files exist yet (fresh install before drizzle-kit generate has been run).
    // Apply schema directly regardless of environment so the container can start.
    console.log("[DB] No migrations found — applying schema directly...");
    applySchemaDirectly();
    return;
  }

  try {
    migrate(db, { migrationsFolder });
    console.log("[DB] Migrations applied successfully");
  } catch (err) {
    console.error("[DB] Migration failed:", err);
    if (process.env.NODE_ENV !== "production") {
      console.log("[DB] Falling back to direct schema apply (development mode)...");
      applySchemaDirectly();
    } else {
      throw err;
    }
  }
}

/**
 * Development fallback: create tables directly from schema if no migrations exist.
 * This avoids needing to run drizzle-kit generate before first launch.
 */
function applySchemaDirectly(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'analyst' CHECK(role IN ('admin','analyst','viewer')),
      invite_code TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      external_id TEXT,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id),
      used_by TEXT REFERENCES users(id),
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      target_url TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK(provider_type IN ('ollama','openai','anthropic','custom')),
      provider_config TEXT NOT NULL DEFAULT '{}',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
      preset TEXT,
      plugins TEXT NOT NULL DEFAULT '[]',
      total_tests INTEGER NOT NULL DEFAULT 0,
      passed_tests INTEGER NOT NULL DEFAULT 0,
      failed_tests INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      scheduled_at INTEGER,
      recurrence TEXT,
      notify_on TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(id),
      tool TEXT NOT NULL CHECK(tool IN ('promptfoo','garak','pyrit','deepteam')),
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('critical','high','medium','low','info')),
      test_name TEXT NOT NULL,
      owasp_category TEXT,
      prompt TEXT,
      response TEXT,
      passed INTEGER NOT NULL,
      evidence TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(id),
      format TEXT NOT NULL CHECK(format IN ('pdf','json','html','csv')),
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_by TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_scans_project_id ON scans(project_id);
    CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
    CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
    CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id);
    CREATE INDEX IF NOT EXISTS idx_scan_results_severity ON scan_results(severity);
    CREATE INDEX IF NOT EXISTS idx_reports_scan_id ON reports(scan_id);
  `);
  // Add new columns to existing tables (safe to run multiple times — errors are ignored)
  const alterStmts = [
    "ALTER TABLE scans ADD COLUMN recurrence TEXT",
    "ALTER TABLE scans ADD COLUMN notify_on TEXT",
    "ALTER TABLE scans ADD COLUMN progress INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE scans ADD COLUMN run_metadata TEXT",
    "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN external_id TEXT",
    "ALTER TABLE users ADD COLUMN custom_role_id TEXT",
  ];
  for (const stmt of alterStmts) {
    try { sqlite.exec(stmt); } catch { /* column already exists */ }
  }

  console.log("[DB] Schema applied directly (development mode)");
}

/**
 * PostgreSQL bootstrap. Mirrors the SQLite DDL above with Postgres column types
 * (text, timestamptz, boolean, integer). Idempotent — CREATE TABLE IF NOT EXISTS
 * — so it is safe to run on every boot.
 */
async function applyPostgresSchema(): Promise<void> {
  if (!pgClient) throw new Error("Postgres client not initialized");

  await pgClient.unsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'analyst' CHECK (role IN ('admin','analyst','viewer')),
      invite_code TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      external_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id),
      used_by TEXT REFERENCES users(id),
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      target_url TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK (provider_type IN ('ollama','openai','anthropic','custom')),
      provider_config TEXT NOT NULL DEFAULT '{}',
      is_archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
      preset TEXT,
      plugins TEXT NOT NULL DEFAULT '[]',
      total_tests INTEGER NOT NULL DEFAULT 0,
      passed_tests INTEGER NOT NULL DEFAULT 0,
      failed_tests INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      scheduled_at TIMESTAMPTZ,
      recurrence TEXT,
      notify_on TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      run_metadata TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(id),
      tool TEXT NOT NULL CHECK (tool IN ('promptfoo','garak','pyrit','deepteam')),
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
      test_name TEXT NOT NULL,
      owasp_category TEXT,
      prompt TEXT,
      response TEXT,
      passed BOOLEAN NOT NULL,
      evidence TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(id),
      format TEXT NOT NULL CHECK (format IN ('pdf','json','html','csv')),
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      updated_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_scans_project_id ON scans(project_id);
    CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
    CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
    CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id);
    CREATE INDEX IF NOT EXISTS idx_scan_results_severity ON scan_results(severity);
    CREATE INDEX IF NOT EXISTS idx_reports_scan_id ON reports(scan_id);

    -- Idempotent column adds for existing databases.
    ALTER TABLE scans ADD COLUMN IF NOT EXISTS run_metadata TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS external_id TEXT;
  `);

  console.log("[DB] PostgreSQL schema applied");
}

// Allow direct execution: tsx src/db/migrate.ts
if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
