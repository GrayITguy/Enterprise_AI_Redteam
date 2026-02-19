#!/usr/bin/env tsx
/**
 * Enterprise AI Red Team — License Key Generator
 *
 * Usage:
 *   # Step 1 (one-time): generate RSA-2048 keypair
 *   npm run license:keygen -- --generate-keys
 *
 *   # Step 2: issue a signed license key for a customer
 *   npm run license:keygen -- \
 *     --email customer@company.com \
 *     --seats 5 \
 *     --expires-days 365 \
 *     --features unlimited-scans,pdf-reports
 *
 *   # Show help
 *   npm run license:keygen -- --help
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = path.resolve(__dirname, "../keys");
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, "license_private.pem");
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, "license_public.pem");

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// ─── Keypair generation ───────────────────────────────────────────────────────

function generateKeypair(): void {
  if (fs.existsSync(PRIVATE_KEY_PATH) || fs.existsSync(PUBLIC_KEY_PATH)) {
    console.error(
      "Keys already exist at keys/. Delete them first if you want to regenerate.\n" +
        `  Private: ${PRIVATE_KEY_PATH}\n` +
        `  Public:  ${PUBLIC_KEY_PATH}`
    );
    process.exit(1);
  }

  fs.mkdirSync(KEYS_DIR, { recursive: true });

  console.log("Generating RSA-2048 keypair...");

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });

  console.log("Keypair generated:");
  console.log(`  Private key (KEEP SECRET): ${PRIVATE_KEY_PATH}`);
  console.log(`  Public key  (ship with app): ${PUBLIC_KEY_PATH}`);
  console.log("");
  console.log("IMPORTANT:");
  console.log("  - Never commit the private key to version control");
  console.log("  - Back up the private key securely — keys issued with it cannot be re-verified with a different key");
  console.log("  - Set RSA_PUBLIC_KEY_PATH env var in production to point to the public key");
}

// ─── Key issuance ─────────────────────────────────────────────────────────────

interface LicensePayload {
  email?: string;
  orderId?: string;
  seats: number;
  features: string[];
  issuedAt: string;
  expiresAt?: string;
}

function issueKey(opts: {
  email?: string;
  orderId?: string;
  seats: number;
  features: string[];
  expiresInDays?: number;
}): string {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error(
      `Private key not found at ${PRIVATE_KEY_PATH}.\n` +
        "Run with --generate-keys first to create a keypair."
    );
    process.exit(1);
  }

  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf-8");

  const now = new Date();
  const payload: LicensePayload = {
    email: opts.email,
    orderId: opts.orderId,
    seats: opts.seats,
    features: opts.features,
    issuedAt: now.toISOString(),
  };

  if (opts.expiresInDays != null && opts.expiresInDays > 0) {
    const expires = new Date(now);
    expires.setDate(expires.getDate() + opts.expiresInDays);
    payload.expiresAt = expires.toISOString();
  }

  // Encode payload
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

  // Sign payload with RSA-SHA256
  const sign = crypto.createSign("SHA256");
  sign.update(payloadB64);
  const sigB64 = sign.sign(privateKey, "base64url");

  const licenseKey = `${payloadB64}.${sigB64}`;
  return licenseKey;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
Enterprise AI Red Team — License Key Generator

COMMANDS:
  --generate-keys               Generate RSA-2048 keypair (run once)
  --help                        Show this help

ISSUE KEY OPTIONS:
  --email <email>               Customer email address
  --order-id <id>               Order / transaction ID (optional)
  --seats <n>                   Number of seats (default: 1)
  --features <f1,f2,...>        Comma-separated feature flags
                                Available: unlimited-scans, pdf-reports, email-notifications,
                                           custom-plugins, priority-support
  --expires-days <n>            Days until expiry (omit for lifetime license)

EXAMPLES:
  # Generate keypair (one-time setup)
  npm run license:keygen -- --generate-keys

  # Lifetime license, 1 seat
  npm run license:keygen -- --email alice@example.com --features unlimited-scans,pdf-reports

  # 1-year team license, 10 seats
  npm run license:keygen -- \\
    --email team@company.com \\
    --seats 10 \\
    --expires-days 365 \\
    --features unlimited-scans,pdf-reports,email-notifications,custom-plugins,priority-support

  # Verify a key (shows decoded payload)
  npm run license:keygen -- --verify <KEY>
`);
}

function verifyKey(licenseKey: string): void {
  const parts = licenseKey.trim().split(".");
  if (parts.length !== 2) {
    console.error("Invalid key format (expected <payload>.<signature>)");
    process.exit(1);
  }
  const [payloadB64, sigB64] = parts as [string, string];

  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    console.error(`Public key not found at ${PUBLIC_KEY_PATH}`);
    process.exit(1);
  }
  const pubKey = fs.readFileSync(PUBLIC_KEY_PATH, "utf-8");

  const verify = crypto.createVerify("SHA256");
  verify.update(payloadB64);
  const valid = verify.verify(pubKey, sigB64, "base64url");

  if (!valid) {
    console.error("INVALID — signature verification failed");
    process.exit(1);
  }

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  console.log("VALID license key");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  if (payload.expiresAt) {
    const expired = new Date(payload.expiresAt) < new Date();
    console.log(`Expires: ${payload.expiresAt}${expired ? " (EXPIRED)" : " (active)"}`);
  } else {
    console.log("Expires: never (lifetime)");
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args["generate-keys"]) {
  generateKeypair();
  process.exit(0);
}

if (args.verify) {
  verifyKey(String(args.verify));
  process.exit(0);
}

// Issue a new key
const featuresRaw = typeof args.features === "string" ? args.features : "";
const features = featuresRaw ? featuresRaw.split(",").map((f) => f.trim()) : [];
const seats = typeof args.seats === "string" ? parseInt(args.seats, 10) : 1;
const expiresInDays =
  typeof args["expires-days"] === "string" ? parseInt(args["expires-days"], 10) : undefined;
const email = typeof args.email === "string" ? args.email : undefined;
const orderId = typeof args["order-id"] === "string" ? args["order-id"] : undefined;

if (!email && !args["order-id"]) {
  console.error("Error: --email is required when issuing a license key.\n");
  printHelp();
  process.exit(1);
}

const key = issueKey({ email, orderId, seats, features, expiresInDays });

console.log("\n=== LICENSE KEY ===");
console.log(key);
console.log("==================\n");

// Also show decoded payload for confirmation
const payloadB64 = key.split(".")[0]!;
const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
console.log("Payload:");
console.log(JSON.stringify(payload, null, 2));
