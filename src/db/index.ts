import Database, { type Database as BetterSqliteDB } from "better-sqlite3";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";
import { DATABASE_URL, isPostgres } from "./dialect.js";
import path from "path";
import fs from "fs";

// ─────────────────────────────────────────────────────────────────────────────
// Driver selection
//
// The public `db` type is ALWAYS the better-sqlite3 Drizzle database over the
// SQLite schema, regardless of the active dialect. Both drivers expose the same
// Drizzle query API for the operations this codebase uses, so the postgres-js
// instance is cast to that type — call sites stay identical and fully typed.
// The one runtime difference (SQLite's synchronous `.get()`/`.all()` vs. the
// awaitable postgres-js builder) is bridged by the `getRow`/`getRows` helpers
// below.
// ─────────────────────────────────────────────────────────────────────────────

let sqliteConn: BetterSqliteDB;
let pgConn: Sql | null = null;
let dbInstance: unknown;

if (isPostgres) {
  const client = postgres(DATABASE_URL);
  pgConn = client;
  dbInstance = drizzlePg(client, { schema: pgSchema });
  // Placeholder — on the Postgres path `sqlite` is only touched by the SQLite
  // migrator/tests, which never run against a postgres:// URL.
  sqliteConn = null as unknown as BetterSqliteDB;
} else {
  // Ensure parent directory exists (skipped for the special ":memory:" path).
  if (DATABASE_URL !== ":memory:") {
    const dir = path.dirname(DATABASE_URL);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  sqliteConn = new Database(DATABASE_URL);

  // Performance + safety pragmas
  sqliteConn.pragma("journal_mode = WAL");
  sqliteConn.pragma("foreign_keys = ON");
  sqliteConn.pragma("synchronous = NORMAL");
  sqliteConn.pragma("cache_size = -64000"); // 64 MB page cache
  sqliteConn.pragma("temp_store = MEMORY");

  dbInstance = drizzleSqlite(sqliteConn, { schema: sqliteSchema });
}

export const db = dbInstance as unknown as BetterSQLite3Database<typeof sqliteSchema>;
export type DB = typeof db;

/** The raw better-sqlite3 connection (null-cast placeholder on the Postgres path). */
export const sqlite: BetterSqliteDB = sqliteConn;

/** The raw postgres-js client, or null when running on SQLite. Used by the migrator. */
export const pgClient: Sql | null = pgConn;

export { isPostgres };

// ─────────────────────────────────────────────────────────────────────────────
// Dialect-neutral fetch helpers.
//
// On SQLite the Drizzle builder exposes synchronous `.get()`/`.all()`; on
// postgres-js the builder is awaited to yield rows. These helpers accept either
// shape and infer the row type from the SQLite builder (which the call sites see
// at compile time), so every call site keeps its exact result type.
// ─────────────────────────────────────────────────────────────────────────────

export async function getRow<T>(
  q: { get: () => T | undefined } | Promise<T[]>
): Promise<T | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = q as any;
  return typeof a.get === "function" ? a.get() : (await a)[0];
}

export async function getRows<T>(
  q: { all: () => T[] } | Promise<T[]>
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = q as any;
  return typeof a.all === "function" ? a.all() : await a;
}
