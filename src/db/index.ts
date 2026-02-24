import Database, { type Database as BetterSqliteDB } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import path from "path";
import fs from "fs";

const dbPath = process.env.DATABASE_URL ?? "./data/eart.db";

// Ensure parent directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const sqlite: BetterSqliteDB = new Database(dbPath);

// Performance + safety pragmas
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("cache_size = -64000"); // 64 MB page cache
sqlite.pragma("temp_store = MEMORY");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
export { sqlite };
