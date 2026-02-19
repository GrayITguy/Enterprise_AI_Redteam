import crypto from "crypto";
import os from "os";
import fs from "fs";
import { v4 as uuid } from "uuid";
import { db } from "./db/index.js";
import { licenseKeys } from "./db/schema.js";

export interface LicensePayload {
  email?: string;
  orderId?: string;
  seats: number;
  features: string[];
  issuedAt?: string;
  expiresAt?: string;
}

export interface LicenseStatus {
  isActivated: boolean;
  email?: string;
  seats?: number;
  features?: string[];
  expiresAt?: Date | null;
  machineId: string;
}

export class LicenseValidator {
  private static getMachineId(): string {
    const cpus = os.cpus();
    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpus[0]?.model ?? ""}`;
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  /**
   * Activate a license key.
   * Format: <base64url-encoded JSON payload>.<base64url-encoded RSA-SHA256 signature>
   */
  static async activate(licenseKey: string): Promise<LicensePayload> {
    const parts = licenseKey.trim().split(".");
    if (parts.length !== 2) {
      throw new Error("Invalid license key format");
    }

    const [payloadB64, sigB64] = parts as [string, string];

    // Try to load public key
    const pubKeyPath = process.env.RSA_PUBLIC_KEY_PATH ?? "./keys/license_public.pem";

    if (!fs.existsSync(pubKeyPath)) {
      // In development without a key file, accept any key for testing
      if (process.env.NODE_ENV === "development") {
        console.warn("[License] No public key found — accepting license in development mode");
        const payload = JSON.parse(
          Buffer.from(payloadB64, "base64url").toString()
        ) as LicensePayload;
        await this.storeLicense(licenseKey, payload);
        return payload;
      }
      throw new Error("License public key not configured");
    }

    const pubKey = fs.readFileSync(pubKeyPath, "utf-8");

    try {
      const verify = crypto.createVerify("SHA256");
      verify.update(payloadB64);
      const valid = verify.verify(pubKey, sigB64, "base64url");

      if (!valid) {
        throw new Error("License signature verification failed");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("signature")) throw err;
      throw new Error("Invalid license key");
    }

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString()
    ) as LicensePayload;

    // Check expiry
    if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
      throw new Error("License key has expired");
    }

    await this.storeLicense(licenseKey, payload);
    return payload;
  }

  private static async storeLicense(
    licenseKey: string,
    payload: LicensePayload
  ): Promise<void> {
    const keyHash = crypto
      .createHash("sha256")
      .update(licenseKey)
      .digest("hex");

    await db
      .insert(licenseKeys)
      .values({
        id: uuid(),
        keyHash,
        email: payload.email ?? null,
        seats: payload.seats ?? 1,
        features: JSON.stringify(payload.features ?? []),
        machineId: this.getMachineId(),
        activatedAt: new Date(),
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      })
      .onConflictDoNothing();
  }

  static async getStatus(): Promise<LicenseStatus> {
    const row = await db.select().from(licenseKeys).limit(1).get();

    return {
      isActivated: !!row,
      email: row?.email ?? undefined,
      seats: row?.seats ?? undefined,
      features: row?.features ? JSON.parse(row.features) : undefined,
      expiresAt: row?.expiresAt ?? null,
      machineId: this.getMachineId(),
    };
  }

  /**
   * Generate a test license key (development only).
   * In production, keys are generated server-side with the private key.
   */
  static generateDevKey(payload: LicensePayload): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sigB64 = Buffer.from("dev-signature").toString("base64url");
    return `${payloadB64}.${sigB64}`;
  }
}
