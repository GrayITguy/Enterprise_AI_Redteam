/**
 * Schema barrel.
 *
 * Call sites `import { scans } from "../../db/schema.js"` unchanged. At runtime
 * they receive the ACTIVE dialect's Drizzle table (SQLite by default, Postgres
 * when DATABASE_URL is a postgres:// URL); at compile time they always see the
 * SQLite table types, so every existing query and test keeps its exact types.
 *
 * The two dialect schemas are faithful mirrors of one another (same table/column
 * names, enums, nullability, defaults and foreign keys), so casting the active
 * table to the SQLite type is sound.
 */
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";
import { isPostgres } from "./dialect.js";

const active = isPostgres ? pgSchema : sqliteSchema;

export const users = active.users as unknown as typeof sqliteSchema.users;
export const inviteCodes = active.inviteCodes as unknown as typeof sqliteSchema.inviteCodes;
export const projects = active.projects as unknown as typeof sqliteSchema.projects;
export const scans = active.scans as unknown as typeof sqliteSchema.scans;
export const scanResults = active.scanResults as unknown as typeof sqliteSchema.scanResults;
export const reports = active.reports as unknown as typeof sqliteSchema.reports;
export const appSettings = active.appSettings as unknown as typeof sqliteSchema.appSettings;
export const auditLog = active.auditLog as unknown as typeof sqliteSchema.auditLog;
