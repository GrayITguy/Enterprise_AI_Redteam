/**
 * Test database helper.
 *
 * Because DATABASE_URL=:memory: is set in vitest.config.ts env block,
 * the `db` singleton from src/db/index.ts is already backed by an in-memory
 * SQLite database. This module provides helpers to bootstrap the schema
 * and reset state between test suites.
 */
import { sqlite } from "../../db/index.js";

const CREATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'analyst' CHECK(role IN ('admin','analyst','viewer')),
    invite_code TEXT,
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

  CREATE TABLE IF NOT EXISTS license_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    email TEXT,
    seats INTEGER NOT NULL DEFAULT 1,
    features TEXT NOT NULL DEFAULT '[]',
    machine_id TEXT,
    activated_at INTEGER,
    expires_at INTEGER
  );
`;

let schemaApplied = false;

/** Apply schema to the in-memory DB (idempotent — safe to call multiple times). */
export function applyTestSchema(): void {
  if (!schemaApplied) {
    sqlite.exec(CREATE_SCHEMA_SQL);
    schemaApplied = true;
  }
}

/** Wipe all rows from all tables while preserving the schema. */
export function clearTestDb(): void {
  sqlite.exec(`
    DELETE FROM scan_results;
    DELETE FROM reports;
    DELETE FROM scans;
    DELETE FROM projects;
    DELETE FROM invite_codes;
    DELETE FROM license_keys;
    DELETE FROM users;
  `);
}
