import crypto from "crypto";
import { db } from "../../db/index.js";
import { appSettings } from "../../db/schema.js";
import { eq, like } from "drizzle-orm";

// ─── Encryption ──────────────────────────────────────────────────────────────
// Derive a 32-byte key from JWT_SECRET for AES-256-CBC encryption of sensitive
// settings (SMTP password, API keys). Falls back to a dev-only placeholder.

const ENCRYPTION_KEY = (process.env.JWT_SECRET ?? "dev-key-change-me")
  .slice(0, 32)
  .padEnd(32, "0");
const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "utf8"),
    iv
  );
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text: string): string {
  const parts = text.split(":");
  if (parts.length < 2) return text; // not encrypted
  const iv = Buffer.from(parts[0]!, "hex");
  const encrypted = parts.slice(1).join(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "utf8"),
    iv
  );
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Keys whose values are encrypted at rest
const SENSITIVE_KEYS = new Set([
  "smtp.password",
  "remediation.providerConfig",
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/** Get a single setting by key. Returns null if not found. */
export async function getSetting(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  if (!row) return null;
  if (SENSITIVE_KEYS.has(key)) {
    try {
      return decrypt(row.value);
    } catch {
      return row.value;
    }
  }
  return row.value;
}

/** Get all settings that start with a given prefix. */
export async function getSettings(
  prefix: string
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(like(appSettings.key, `${prefix}%`))
    .all();
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (SENSITIVE_KEYS.has(row.key)) {
      try {
        result[row.key] = decrypt(row.value);
      } catch {
        result[row.key] = row.value;
      }
    } else {
      result[row.key] = row.value;
    }
  }
  return result;
}

/** Upsert a setting. Sensitive keys are encrypted automatically. */
export async function setSetting(
  key: string,
  value: string,
  userId: string
): Promise<void> {
  const storedValue = SENSITIVE_KEYS.has(key) ? encrypt(value) : value;
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key, value: storedValue, updatedAt: now, updatedBy: userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: storedValue, updatedAt: now, updatedBy: userId },
    });
}
