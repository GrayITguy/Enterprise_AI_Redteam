import PDFDocument from "pdfkit";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";
import { db, getRow, getRows } from "../../db/index.js";
import { scans, scanResults, reports, projects } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";
import { OWASP_NAMES } from "../config/constants.js";
import { safeJsonParse } from "../utils/helpers.js";
import { getFrameworkMapping, frameworkCoverage } from "../config/frameworkMappings.js";

const SEVERITY_COLORS = {
  critical: [220, 38, 38],
  high: [234, 88, 12],
  medium: [217, 119, 6],
  low: [101, 163, 13],
  info: [59, 130, 246],
} as const;

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];
const SEVERITY_HEX: Record<string, string> = {
  critical: "#dc2626", high: "#ea580c", medium: "#d97706", low: "#65a30d", info: "#3b82f6",
};

/** Escape a value for a single CSV cell (RFC 4180 quoting). */
function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Escape a value for safe interpolation into HTML text/attributes. */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ReportHtmlData {
  projectName: string;
  generatedAt: string;
  total: number;
  failed: number;
  failRate: number;
  toolCount: number;
  sevCounts: Record<string, number>;
  owaspRows: Array<{ name: string; total: number; failed: number }>;
  findings: Array<{
    testName: string; severity: string; tool: string; category: string;
    owaspCategory: string | null; prompt: string | null; response: string | null;
  }>;
}

/** Render a self-contained (no external assets) HTML security report. */
function renderReportHtml(d: ReportHtmlData): string {
  const sevCards = SEVERITY_ORDER.map(
    (s) => `<div class="card"><div class="num" style="color:${SEVERITY_HEX[s]}">${d.sevCounts[s] ?? 0}</div><div class="lbl">${s}</div></div>`
  ).join("");

  const owaspRows = d.owaspRows
    .map((o) => {
      const status = o.total === 0 ? "Not Tested" : o.failed === 0 ? "PASS" : `${o.failed} FAIL`;
      const color = o.total === 0 ? "#9ca3af" : o.failed === 0 ? "#16a34a" : "#dc2626";
      return `<tr><td>${escapeHtml(o.name)}</td><td style="text-align:right;color:${color};font-weight:600">${status}</td></tr>`;
    })
    .join("");

  const findingRows = d.findings
    .map(
      (f) => `<div class="finding">
      <div class="fhead"><span class="badge" style="background:${SEVERITY_HEX[f.severity] ?? "#6b7280"}">${escapeHtml(f.severity.toUpperCase())}</span> <strong>${escapeHtml(f.testName)}</strong></div>
      <div class="meta">${f.owaspCategory ? `OWASP: ${escapeHtml(f.owaspCategory)} &middot; ` : ""}Tool: ${escapeHtml(f.tool)} &middot; Category: ${escapeHtml(f.category)}</div>
      ${f.prompt ? `<div class="kv"><em>Prompt:</em> ${escapeHtml(f.prompt.slice(0, 500))}${f.prompt.length > 500 ? "…" : ""}</div>` : ""}
      ${f.response ? `<div class="kv"><em>Response:</em> ${escapeHtml(f.response.slice(0, 500))}${f.response.length > 500 ? "…" : ""}</div>` : ""}
    </div>`
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EART Report — ${escapeHtml(d.projectName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; margin: 0; background: #f8fafc; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 64px; }
  header { background: #0f172a; color: #fff; padding: 32px; border-radius: 12px; margin-bottom: 24px; }
  header h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: .04em; }
  header p { margin: 0; color: #94a3b8; font-size: 14px; }
  h2 { font-size: 16px; margin: 28px 0 12px; }
  .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center; }
  .card .num { font-size: 26px; font-weight: 700; }
  .card .lbl { font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: .05em; }
  .summary { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; font-size: 14px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  td { padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
  .finding { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #cbd5e1; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
  .fhead { font-size: 14px; margin-bottom: 4px; }
  .badge { color: #fff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 6px; }
  .kv { font-size: 12px; color: #334155; margin-top: 4px; word-break: break-word; }
  .kv em { color: #0f172a; font-style: normal; font-weight: 600; }
  footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; }
</style></head>
<body><div class="wrap">
  <header>
    <h1>Enterprise AI Red Team — Security Assessment</h1>
    <p>${escapeHtml(d.projectName)} &middot; Generated ${escapeHtml(d.generatedAt)}</p>
  </header>
  <div class="summary">
    This report summarizes the AI security assessment for <strong>${escapeHtml(d.projectName)}</strong>.
    The scan ran ${d.total} tests across ${d.toolCount} tool(s); <strong>${d.failed}</strong> failed
    (${d.failRate}% failure rate).
  </div>
  <h2>Findings by severity</h2>
  <div class="cards">${sevCards}</div>
  <h2>OWASP LLM Top 10 coverage</h2>
  <table>${owaspRows}</table>
  <h2>Failed findings (${d.findings.length})</h2>
  ${findingRows || '<div class="summary">No failed findings 🎉</div>'}
  <footer>Enterprise AI Red Team Platform — self-hosted, open source</footer>
</div></body></html>`;
}

export class ReportGenerator {
  private reportDir: string;

  constructor() {
    this.reportDir = process.env.REPORT_DIR ?? "./data/reports";
    fs.mkdirSync(this.reportDir, { recursive: true });
  }

  async generatePDF(scanId: string): Promise<string> {
    const scan = await getRow(db.select().from(scans).where(eq(scans.id, scanId)));
    if (!scan) throw new Error("Scan not found");

    const project = await getRow(db
      .select()
      .from(projects)
      .where(eq(projects.id, scan.projectId))
      );

    const results = await getRows(db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanId, scanId))
      );

    const reportId = uuid();
    const filename = `eart-report-${scanId.slice(0, 8)}-${reportId.slice(0, 8)}.pdf`;
    const filePath = path.join(this.reportDir, filename);

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: "Enterprise AI Red Team Report",
          Author: "Enterprise AI Red Team Platform",
          Subject: `Security Assessment for ${project?.name ?? scanId}`,
        },
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      stream.on("finish", resolve);
      stream.on("error", reject);

      // ── Cover Page ──────────────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 200).fill("#0f172a");
      doc
        .fillColor("#ffffff")
        .fontSize(28)
        .font("Helvetica-Bold")
        .text("ENTERPRISE AI RED TEAM", 50, 60, { align: "center" })
        .fontSize(16)
        .font("Helvetica")
        .text("Security Assessment Report", 50, 100, { align: "center" });

      doc.fillColor("#64748b").fontSize(11).text(
        `Generated: ${new Date().toISOString().split("T")[0]}`,
        50,
        150,
        { align: "center" }
      );

      doc.moveDown(4);

      // ── Executive Summary ──────────────────────────────────────────────────
      doc
        .fillColor("#0f172a")
        .fontSize(18)
        .font("Helvetica-Bold")
        .text("Executive Summary", { underline: false });
      doc.moveDown(0.5);

      const counts = { failed: 0, critical: 0, high: 0 };
      for (const r of results) {
        if (!r.passed) {
          counts.failed++;
          if (r.severity === "critical") counts.critical++;
          else if (r.severity === "high") counts.high++;
        }
      }
      const failRate = results.length > 0
        ? Math.round((counts.failed / results.length) * 100)
        : 0;

      doc
        .fillColor("#374151")
        .fontSize(11)
        .font("Helvetica")
        .text(
          `This report summarizes the AI security assessment for the project "${project?.name ?? "Unknown"}". ` +
          `The scan tested ${results.length} security controls across ${new Set(results.map((r) => r.tool)).size} tools. ` +
          `${counts.failed} tests failed (${failRate}% failure rate), including ` +
          `${counts.critical} critical and ${counts.high} high severity findings.`
        );

      doc.moveDown(1.5);

      // Severity summary table
      this.addSeverityTable(doc, results);

      doc.moveDown(1.5);

      // ── OWASP LLM Top 10 Mapping ──────────────────────────────────────────
      doc
        .fillColor("#0f172a")
        .fontSize(16)
        .font("Helvetica-Bold")
        .text("OWASP LLM Top 10 Coverage");
      doc.moveDown(0.5);

      // Single-pass aggregation for OWASP categories
      const owaspAgg = new Map<string, { total: number; failed: number }>();
      for (const r of results) {
        if (!r.owaspCategory) continue;
        let entry = owaspAgg.get(r.owaspCategory);
        if (!entry) { entry = { total: 0, failed: 0 }; owaspAgg.set(r.owaspCategory, entry); }
        entry.total++;
        if (!r.passed) entry.failed++;
      }
      const owaspResults = Object.entries(OWASP_NAMES).map(([key, name]) => {
        const agg = owaspAgg.get(key);
        return { key, name, total: agg?.total ?? 0, failed: agg?.failed ?? 0 };
      });

      for (const owasp of owaspResults) {
        const tested = owasp.total > 0;
        const statusColor = !tested ? "#9ca3af" : owasp.failed === 0 ? "#16a34a" : "#dc2626";
        const statusText = !tested ? "Not Tested" : owasp.failed === 0 ? "PASS" : `${owasp.failed} FAIL`;

        const rowY = doc.y;
        doc
          .fillColor("#374151")
          .fontSize(10)
          .font("Helvetica")
          .text(owasp.name, 50, rowY, { width: 350 });
        doc
          .fillColor(statusColor)
          .fontSize(10)
          .font("Helvetica-Bold")
          .text(statusText, 400, rowY, { width: 145, align: "right" });
        doc.x = 50;
        doc.y = rowY + 16;
      }

      doc.moveDown(1);

      // ── Critical & High Findings ──────────────────────────────────────────
      const criticalHighFindings = results
        .filter((r) => !r.passed && (r.severity === "critical" || r.severity === "high"))
        .slice(0, 20);

      if (criticalHighFindings.length > 0) {
        doc.x = 50; // Ensure left margin after OWASP section
        doc
          .fillColor("#0f172a")
          .fontSize(16)
          .font("Helvetica-Bold")
          .text("Critical & High Severity Findings");
        doc.moveDown(0.5);

        for (const finding of criticalHighFindings) {
          // Check if we need a new page
          if (doc.y > doc.page.height - 150) doc.addPage();

          const color = SEVERITY_COLORS[finding.severity as keyof typeof SEVERITY_COLORS] ?? [0, 0, 0];
          doc
            .fillColor(color as [number, number, number])
            .fontSize(11)
            .font("Helvetica-Bold")
            .text(`[${finding.severity.toUpperCase()}] ${finding.testName}`);

          doc.fillColor("#6b7280").fontSize(9).font("Helvetica");
          if (finding.owaspCategory) {
            doc.text(`OWASP: ${finding.owaspCategory}  |  Tool: ${finding.tool}  |  Category: ${finding.category}`);
          } else {
            doc.text(`Tool: ${finding.tool}  |  Category: ${finding.category}`);
          }

          if (finding.prompt) {
            doc.moveDown(0.3);
            doc.fillColor("#374151").fontSize(9).text("Prompt:", { continued: true });
            doc
              .font("Helvetica-Oblique")
              .fillColor("#4b5563")
              .text(` ${finding.prompt.slice(0, 200)}${finding.prompt.length > 200 ? "..." : ""}`);
          }

          doc.moveDown(0.7);
          doc.strokeColor("#e5e7eb").lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
          doc.moveDown(0.5);
        }
      }

      // ── Footer ─────────────────────────────────────────────────────────────
      const pageCount = doc.bufferedPageRange().count + 1;
      doc
        .fillColor("#9ca3af")
        .fontSize(8)
        .text(
          `Enterprise AI Red Team Platform — enterpriseairedteam.com — Page ${pageCount}`,
          50,
          doc.page.height - 30,
          { align: "center" }
        );

      doc.end();
    });

    const stat = await fsp.stat(filePath);

    await db.insert(reports).values({
      id: reportId,
      scanId,
      format: "pdf",
      filePath,
      sizeBytes: stat.size,
      createdAt: new Date(),
    });

    logger.info(`[ReportGenerator] PDF report generated: ${filePath} (${stat.size} bytes)`);
    return reportId;
  }

  async generateJSON(scanId: string): Promise<string> {
    const scan = await getRow(db.select().from(scans).where(eq(scans.id, scanId)));
    if (!scan) throw new Error("Scan not found");

    const results = await getRows(db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanId, scanId))
      );

    const reportId = uuid();
    const filename = `eart-report-${scanId.slice(0, 8)}-${reportId.slice(0, 8)}.json`;
    const filePath = path.join(this.reportDir, filename);

    const payload = {
      scan: {
        ...scan,
        plugins: safeJsonParse(scan.plugins, []),
        runMetadata: scan.runMetadata ? safeJsonParse(scan.runMetadata, null) : null,
      },
      results: results.map((r) => ({
        ...r,
        evidence: safeJsonParse(r.evidence, {}),
        frameworks: getFrameworkMapping(r.category, r.owaspCategory ?? undefined),
      })),
      summary: {
        total: results.length,
        passed: results.reduce((n, r) => n + (r.passed ? 1 : 0), 0),
        failed: results.reduce((n, r) => n + (r.passed ? 0 : 1), 0),
      },
      frameworkCoverage: frameworkCoverage(results),
      generatedAt: new Date().toISOString(),
    };

    await fsp.writeFile(filePath, JSON.stringify(payload, null, 2));
    const stat = await fsp.stat(filePath);

    await db.insert(reports).values({
      id: reportId,
      scanId,
      format: "json",
      filePath,
      sizeBytes: stat.size,
      createdAt: new Date(),
    });

    return reportId;
  }

  async generateCSV(scanId: string): Promise<string> {
    const scan = await getRow(db.select().from(scans).where(eq(scans.id, scanId)));
    if (!scan) throw new Error("Scan not found");

    const results = await getRows(db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanId, scanId))
      );

    const reportId = uuid();
    const filename = `eart-report-${scanId.slice(0, 8)}-${reportId.slice(0, 8)}.csv`;
    const filePath = path.join(this.reportDir, filename);

    const columns = [
      "testName", "tool", "category", "severity", "owaspCategory",
      "passed", "prompt", "response",
    ] as const;
    const header = columns.join(",");
    const rows = results.map((r) =>
      columns
        .map((c) => csvCell(c === "passed" ? (r.passed ? "pass" : "fail") : r[c]))
        .join(",")
    );
    // Prefix with a UTF-8 BOM so Excel opens non-ASCII prompts/responses correctly.
    await fsp.writeFile(filePath, "﻿" + [header, ...rows].join("\r\n") + "\r\n");
    const stat = await fsp.stat(filePath);

    await db.insert(reports).values({
      id: reportId, scanId, format: "csv", filePath, sizeBytes: stat.size, createdAt: new Date(),
    });
    logger.info(`[ReportGenerator] CSV report generated: ${filePath} (${stat.size} bytes)`);
    return reportId;
  }

  async generateHTML(scanId: string): Promise<string> {
    const scan = await getRow(db.select().from(scans).where(eq(scans.id, scanId)));
    if (!scan) throw new Error("Scan not found");

    const project = await getRow(db.select().from(projects).where(eq(projects.id, scan.projectId)));
    const results = await getRows(db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanId, scanId))
      );

    const reportId = uuid();
    const filename = `eart-report-${scanId.slice(0, 8)}-${reportId.slice(0, 8)}.html`;
    const filePath = path.join(this.reportDir, filename);

    const total = results.length;
    const failed = results.filter((r) => !r.passed).length;
    const failRate = total > 0 ? Math.round((failed / total) * 100) : 0;

    const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const r of results) if (!r.passed) sevCounts[r.severity] = (sevCounts[r.severity] ?? 0) + 1;

    const owaspAgg = new Map<string, { total: number; failed: number }>();
    for (const r of results) {
      if (!r.owaspCategory) continue;
      const e = owaspAgg.get(r.owaspCategory) ?? { total: 0, failed: 0 };
      e.total++;
      if (!r.passed) e.failed++;
      owaspAgg.set(r.owaspCategory, e);
    }

    const failedFindings = results
      .filter((r) => !r.passed)
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

    const html = renderReportHtml({
      projectName: project?.name ?? scanId,
      generatedAt: new Date().toISOString().split("T")[0] ?? "",
      total, failed, failRate,
      toolCount: new Set(results.map((r) => r.tool)).size,
      sevCounts,
      owaspRows: Object.entries(OWASP_NAMES).map(([key, name]) => {
        const a = owaspAgg.get(key);
        return { name, total: a?.total ?? 0, failed: a?.failed ?? 0 };
      }),
      findings: failedFindings,
    });

    await fsp.writeFile(filePath, html);
    const stat = await fsp.stat(filePath);

    await db.insert(reports).values({
      id: reportId, scanId, format: "html", filePath, sizeBytes: stat.size, createdAt: new Date(),
    });
    logger.info(`[ReportGenerator] HTML report generated: ${filePath} (${stat.size} bytes)`);
    return reportId;
  }

  private addSeverityTable(doc: PDFKit.PDFDocument, results: Array<{ severity: string; passed: boolean }>): void {
    const severities = ["critical", "high", "medium", "low", "info"] as const;
    const tableX = 50;
    let tableY = doc.y;
    const colWidth = 97;

    // Header
    doc.rect(tableX, tableY, colWidth * 5, 22).fill("#0f172a");
    doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");

    for (let i = 0; i < severities.length; i++) {
      doc.text(
        severities[i].toUpperCase(),
        tableX + i * colWidth + 5,
        tableY + 7,
        { width: colWidth - 10, align: "center" }
      );
    }

    tableY += 22;
    doc.rect(tableX, tableY, colWidth * 5, 28).fill("#f8fafc").stroke();

    // Single-pass severity count
    const sevCounts: Record<string, number> = {};
    for (const r of results) {
      if (!r.passed) sevCounts[r.severity] = (sevCounts[r.severity] ?? 0) + 1;
    }

    doc.fontSize(14).font("Helvetica-Bold");
    for (let i = 0; i < severities.length; i++) {
      const sev = severities[i];
      const color = SEVERITY_COLORS[sev] as [number, number, number];
      doc
        .fillColor(color)
        .text(String(sevCounts[sev] ?? 0), tableX + i * colWidth + 5, tableY + 6, {
          width: colWidth - 10,
          align: "center",
        });
    }

    doc.moveDown(0.5);
    doc.y = tableY + 35;
    doc.x = 50; // Reset to left margin
  }
}
