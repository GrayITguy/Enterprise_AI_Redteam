import nodemailer from "nodemailer";
import { logger } from "../utils/logger.js";
import { getSetting } from "./settingsService.js";

/**
 * Returns a nodemailer transport.
 * Resolution order: DB settings → environment variables → null (disabled).
 */
async function createTransport(): Promise<ReturnType<typeof nodemailer.createTransport> | null> {
  // Try DB settings first
  const dbHost = await getSetting("smtp.host");
  const host = dbHost || process.env.SMTP_HOST;
  if (!host) return null;

  const useDb = !!dbHost;

  const port = useDb
    ? parseInt((await getSetting("smtp.port")) ?? "587", 10)
    : parseInt(process.env.SMTP_PORT ?? "587", 10);

  const secure = useDb
    ? (await getSetting("smtp.secure")) === "true"
    : process.env.SMTP_SECURE === "true";

  const user = useDb ? (await getSetting("smtp.user")) ?? "" : process.env.SMTP_USER ?? "";
  const pass = useDb ? (await getSetting("smtp.password")) ?? "" : process.env.SMTP_PASS ?? "";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

/** Resolve the "From" address (DB → env → default). */
async function getFromAddress(): Promise<string> {
  return (
    (await getSetting("smtp.from")) ??
    process.env.SMTP_FROM ??
    "no-reply@ai-redteam.local"
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ScanCompleteParams {
  toEmail: string;
  projectName: string;
  scanId: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  completedAt: Date;
}

export async function sendScanCompleteEmail(params: ScanCompleteParams): Promise<void> {
  const transport = await createTransport();
  if (!transport) {
    logger.debug("[Email] SMTP not configured — skipping scan-complete notification");
    return;
  }

  const { toEmail, projectName, scanId, totalTests, passedTests, failedTests, completedAt } = params;
  const from = await getFromAddress();
  const baseUrl = (process.env.APP_URL ?? "http://localhost:15500").replace(/\/$/, "");
  const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;

  const subject =
    failedTests > 0
      ? `[AI Red Team] ⚠️ ${failedTests} finding${failedTests !== 1 ? "s" : ""} — ${projectName}`
      : `[AI Red Team] ✅ ${projectName} scan complete — no findings`;

  const accentColor = failedTests > 0 ? "#dc2626" : "#22c55e";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;max-width:600px">

        <!-- Header -->
        <tr><td style="background:${accentColor};padding:4px 0"></td></tr>
        <tr><td style="padding:28px 32px 20px">
          <div style="display:inline-flex;align-items:center;gap:10px">
            <span style="font-size:22px;font-weight:700;color:#f1f5f9">Enterprise AI Red Team</span>
          </div>
          <h2 style="margin:16px 0 4px;font-size:18px;color:#f1f5f9">Scan complete: ${escapeHtml(projectName)}</h2>
          <p style="margin:0;color:#94a3b8;font-size:13px">${completedAt.toUTCString()}</p>
        </td></tr>

        <!-- Stats row -->
        <tr><td style="padding:0 32px 24px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden">
            <tr>
              <td width="25%" align="center" style="background:#0f172a;padding:16px 8px;border-right:1px solid #334155">
                <div style="font-size:32px;font-weight:700;color:#f1f5f9">${totalTests}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Tests</div>
              </td>
              <td width="25%" align="center" style="background:#0f172a;padding:16px 8px;border-right:1px solid #334155">
                <div style="font-size:32px;font-weight:700;color:#22c55e">${passedTests}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Passed</div>
              </td>
              <td width="25%" align="center" style="background:#0f172a;padding:16px 8px;border-right:1px solid #334155">
                <div style="font-size:32px;font-weight:700;color:#dc2626">${failedTests}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Findings</div>
              </td>
              <td width="25%" align="center" style="background:#0f172a;padding:16px 8px">
                <div style="font-size:32px;font-weight:700;color:#f1f5f9">${passRate}%</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.5px">Pass Rate</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 32px 32px">
          <a href="${baseUrl}/scans/${scanId}/results"
             style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
            View Full Report →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #334155">
          <p style="margin:0;font-size:12px;color:#475569">
            Enterprise AI Red Team Platform &middot;
            <a href="${baseUrl}" style="color:#475569">${baseUrl}</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Scan complete: ${projectName}`,
    `Completed: ${completedAt.toUTCString()}`,
    "",
    `Tests: ${totalTests}  |  Passed: ${passedTests}  |  Findings: ${failedTests}  |  Pass rate: ${passRate}%`,
    "",
    `View report: ${baseUrl}/scans/${scanId}/results`,
  ].join("\n");

  try {
    await transport.sendMail({ from, to: toEmail, subject, html, text });
    logger.info(`[Email] Scan-complete notification sent to ${toEmail}`);
  } catch (err) {
    logger.error(`[Email] Failed to send notification to ${toEmail}: ${err}`);
  }
}

/** Send a simple test email to verify SMTP configuration. */
export async function sendTestEmail(toEmail: string): Promise<void> {
  const transport = await createTransport();
  if (!transport) {
    throw new Error("SMTP is not configured. Set SMTP settings in the UI or via environment variables.");
  }

  const from = await getFromAddress();

  await transport.sendMail({
    from,
    to: toEmail,
    subject: "[AI Red Team] SMTP Test",
    text: "This is a test email from Enterprise AI Red Team Platform. SMTP is configured correctly!",
    html: `<div style="font-family:sans-serif;padding:20px">
      <h2>SMTP Configuration Test</h2>
      <p>This is a test email from <strong>Enterprise AI Red Team Platform</strong>.</p>
      <p style="color:#22c55e;font-weight:bold">SMTP is configured correctly!</p>
    </div>`,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
