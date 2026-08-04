/**
 * Central dialect detection shared by the schema barrel and the db factory.
 *
 * A `postgres://` or `postgresql://` DATABASE_URL selects the PostgreSQL
 * (postgres-js) driver; anything else (a filesystem path or `:memory:`) uses
 * the default SQLite (better-sqlite3) driver.
 */
export const DATABASE_URL = process.env.DATABASE_URL ?? "./data/eart.db";

export const isPostgres = /^postgres(ql)?:\/\//.test(DATABASE_URL);
