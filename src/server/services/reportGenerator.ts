import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { db } from "../../db/index.js";
import { scans, scanResults, reports, projects } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";

const SEVERITY_COLORS = {
  critical: [220, 38, 38],
  high: [234, 88, 12],
  medium: [217, 119, 6],
  low: [101, 163, 13],
  info: [59, 130, 246],
} as const;

const OWASP_NAMES: Record<string, string> = {
  LLM01: "LLM01 - Prompt Injection",
  LLM02: "LLM02 - Insecure Output Handling",
  LLM03: "LLM03 - Training Data Poisoning",
  LLM04: "LLM04 - Model Denial of Service",
  LLM05: "LLM05 - Supply Chain Vulnerabilities",
  LLM06: "LLM06 - Sensitive Information Disclosure",
  LLM07: "LLM07 - Insecure Plugin Design",
  LLM08: "LLM08 - Excessive Agency",
  LLM09: "LLM09 - Overreliance",
  LLM10: "LLM10 - Model Theft",
};

export class ReportGenerator {
  private reportDir: string;

  constructor() {
    this.reportDir = process.env.REPORT_DIR ?? "./data/reports";
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  async generatePDF(scanId: string): Promise<string> {
    const scan = await db.select().from(scans).where(eq(scans.id, scanId)).get();
    if (!scan) throw new Error("Scan not found");

    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, scan.projectId))
      .get();

    const results = await db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanId, scanId))
      .all();

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

      const failedCount = results.filter((r) => !r.passed).length;
      const failRate = results.length > 0
        ? Math.round((failedCount / results.length) * 100)
        : 0;

      const criticalCount = results.filter((r) => r.severity === "critical" && !r.passed).length;
      const highCount = results.filter((r) => r.severity === "high" && !r.passed).length;

      doc
        .fillColor("#374151")
        .fontSize(11)
        .font("Helvetica")
        .text(
          `This report summarizes the AI security assessment for the project "${project?.name ?? "Unknown"}". ` +
          `The scan tested ${results.length} security controls across ${new Set(results.map((r) => r.tool)).size} tools. ` +
          `${failedCount} tests failed (${failRate}% failure rate), including ` +
          `${criticalCount} critical and ${highCount} high severity findings.`
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

      const owaspResults = Object.entries(OWASP_NAMES).map(([key, name]) => {
        const catResults = results.filter((r) => r.owaspCategory === key);
        const catFailed = catResults.filter((r) => !r.passed).length;
        return { key, name, total: catResults.length, failed: catFailed };
      });

      for (const owasp of owaspResults) {
        const tested = owasp.total > 0;
        const statusColor = !tested ? "#9ca3af" : owasp.failed === 0 ? "#16a34a" : "#dc2626";
        const statusText = !tested ? "Not Tested" : owasp.failed === 0 ? "PASS" : `${owasp.failed} FAIL`;

        doc
          .fillColor("#374151")
          .fontSize(10)
          .font("Helvetica")
          .text(owasp.name, { continued: true })
          .fillColor(statusColor)
          .text(` — ${statusText}`, { align: "right" });
        doc.moveDown(0.3);
      }

      doc.moveDown(1);

      // ── Critical & High Findings ──────────────────────────────────────────
      const criticalHighFindings = results
        .filter((r) => !r.passed && (r.severity === "critical" || r.severity === "high"))
        .slice(0, 20);

      if (criticalHighFindings.length > 0) {
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

    const stat = fs.statSync(filePath);
    const reportId2 = uuid();

    await db.insert(reports).values({
      id: reportId2,
      scanId,
      format: "pdf",
      filePath,
      sizeBytes: stat.size,
      createdAt: new Date(),
    });

    logger.info(`[ReportGenerator] PDF report generated: ${filePath} (${stat.size} bytes)`);
    return reportId2;
  }

  async generateJSON(scanId: string): Promise<string> {
    const scan = await db.select().from(scans).where(eq(scans.id, scanId)).get();
    if (!scan) throw new Error("Scan not found");

    const results = await db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanId, scanId))
      .all();

    const reportId = uuid();
    const filename = `eart-report-${scanId.slice(0, 8)}-${reportId.slice(0, 8)}.json`;
    const filePath = path.join(this.reportDir, filename);

    const payload = {
      scan: {
        ...scan,
        plugins: JSON.parse(scan.plugins),
      },
      results: results.map((r) => ({ ...r, evidence: JSON.parse(r.evidence) })),
      summary: {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
      },
      generatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    const stat = fs.statSync(filePath);

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

    doc.fontSize(14).font("Helvetica-Bold");
    for (let i = 0; i < severities.length; i++) {
      const sev = severities[i];
      const count = results.filter((r) => r.severity === sev && !r.passed).length;
      const color = SEVERITY_COLORS[sev] as [number, number, number];
      doc
        .fillColor(color)
        .text(String(count), tableX + i * colWidth + 5, tableY + 6, {
          width: colWidth - 10,
          align: "center",
        });
    }

    doc.moveDown(0.5);
    doc.y = tableY + 35;
  }
}
