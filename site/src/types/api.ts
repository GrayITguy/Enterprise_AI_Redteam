/**
 * Shared API response/entity types for the EART backend.
 *
 * These describe the JSON shapes the Express API actually returns (dates are
 * ISO strings, `providerConfig` is redacted, booleans are real booleans, etc.),
 * so the frontend can drop its `as any` casts. Keep in sync with the route
 * handlers in `src/server/routes/*` — see the API reference in README.md.
 */

// ─── Enums / unions ─────────────────────────────────────────────────────────
export type Role = "admin" | "analyst" | "viewer";
export type ProviderType = "ollama" | "openai" | "anthropic" | "custom";
export type ScanStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type ScanPreset = "quick" | "owasp" | "full";
export type Recurrence = "daily" | "weekly" | "monthly";
export type NotifyOn = "always" | "failure";
export type PluginTool = "promptfoo" | "garak" | "pyrit" | "deepteam";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type OwaspCategory =
  | "LLM01" | "LLM02" | "LLM03" | "LLM04" | "LLM05"
  | "LLM06" | "LLM07" | "LLM08" | "LLM09" | "LLM10";
export type ReportFormat = "pdf" | "json" | "html" | "csv";

// ─── Generic ────────────────────────────────────────────────────────────────
export interface ApiError {
  error: string;
  details?: unknown;
}

/** Shape of an axios error carrying an {@link ApiError} body. */
export interface AxiosApiError {
  response?: { data?: ApiError; status?: number };
}

/** Pull the server error message out of a caught mutation/query error. */
export function apiErrorMessage(err: unknown): string | undefined {
  return (err as AxiosApiError)?.response?.data?.error;
}

// ─── Auth ───────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthTokenResponse {
  token: string;
  user: AuthUser;
}

export interface InviteResponse {
  code: string;
  expiresAt: string | null;
}

/** A user row as returned by the admin `GET /api/users` endpoint (no secrets). */
export interface ManagedUser {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
}

// ─── Projects ───────────────────────────────────────────────────────────────
export interface RedactedProviderConfig {
  hasApiKey: boolean;
  apiKeyHint?: string;
  /** Common provider-config fields (present depending on provider type). */
  model?: string;
  endpoint?: string;
  systemPrompt?: string;
  headers?: Record<string, string>;
  [k: string]: unknown;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  targetUrl: string;
  providerType: ProviderType;
  providerConfig: RedactedProviderConfig;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithRecentScans extends Project {
  recentScans: Array<{ id: string; status: ScanStatus; createdAt: string }>;
}

// ─── Plugins / catalog ──────────────────────────────────────────────────────
export interface Plugin {
  id: string;
  name: string;
  description: string;
  tool: PluginTool;
  category: string;
  severity: Severity;
  owaspCategory?: OwaspCategory;
  tags: string[];
}

export interface Preset {
  name: string;
  description: string;
  plugins: string[];
}

export interface ScanCatalog {
  plugins: Plugin[];
  presets: Record<string, Preset>;
}

// ─── Scans ──────────────────────────────────────────────────────────────────
export interface ScanStats {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ScanHistoryItem {
  id: string;
  projectName: string | null;
  completedAt: string | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

export interface UpcomingScan {
  id: string;
  projectId: string;
  status: ScanStatus;
  preset: string | null;
  scheduledAt: string | null;
  recurrence: string | null;
  createdAt: string;
  projectName: string | null;
}

export interface ScanListItem {
  id: string;
  projectId: string;
  userId: string;
  status: ScanStatus;
  preset: string | null;
  plugins: string[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  projectName: string | null;
}

export interface ScanDetail {
  id: string;
  projectId: string;
  userId: string;
  status: ScanStatus;
  preset: string | null;
  plugins: string[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  progress: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  projectName: string | null;
  projectTargetUrl: string | null;
}

export interface CreatedScan {
  id: string;
  projectId: string;
  userId: string;
  status: ScanStatus;
  preset: string | null;
  plugins: string[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  progress: number;
  errorMessage: string | null;
  scheduledAt: string | null;
  recurrence: Recurrence | null;
  notifyOn: NotifyOn | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ScanResult {
  id: string;
  scanId: string;
  tool: PluginTool;
  category: string;
  severity: Severity;
  testName: string;
  owaspCategory: string | null;
  prompt: string | null;
  response: string | null;
  passed: boolean;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface CancelScanResponse {
  message: string;
}

/** Paginated response from `GET /api/scans/:id/results`. */
export interface PaginatedScanResults {
  results: ScanResult[];
  total: number;
  limit: number;
  offset: number;
}

export type DiffStatus = "fixed" | "improved" | "unchanged" | "not-retested";

export interface ScanDiffCategory {
  category: string;
  name: string;
  beforeFailed: number;
  afterFailed: number | null;
  status: DiffStatus;
}

/** Before/after retest comparison from `GET /api/scans/:id/diff?original=...`. */
export interface ScanDiff {
  originalScanId: string;
  retestScanId: string;
  categories: ScanDiffCategory[];
  summary: {
    fixed: number;
    improved: number;
    unchanged: number;
    beforeFailed: number;
    afterFailed: number;
    retestStatus: ScanStatus;
  };
}

// ─── Results / narrative ────────────────────────────────────────────────────
export interface ResultsSummary {
  total: number;
  passed: number;
  failed: number;
  bySeverity: Record<Severity, number>;
  byTool: Record<string, { total: number; failed: number }>;
  byOwaspCategory: Record<string, { total: number; failed: number }>;
}

export interface NarrativeResponse {
  narrative: string;
}

// ─── Remediation ────────────────────────────────────────────────────────────
export interface RemediationCategory {
  owaspId: string;
  owaspName: string;
  severity: "critical" | "high" | "medium" | "low";
  findingCount: number;
  rootCause: string;
  remediation: string[];
  systemPromptFix: string | null;
  guardrailConfig: string | null;
  priority: "P0" | "P1" | "P2" | "P3";
}

export interface RemediationPlan {
  riskScore: number;
  summary: string;
  categories: RemediationCategory[];
  systemPromptRecommendation?: string | null;
}

export interface RemediationGenerateResponse {
  plan: RemediationPlan;
  raw?: boolean;
}

export interface RemediationVerifyResponse extends CreatedScan {
  originalScanId: string;
  retestingPluginCount: number;
}

// ─── Reports ────────────────────────────────────────────────────────────────
export interface Report {
  id: string;
  scanId: string;
  format: ReportFormat;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ReportGenerateResponse {
  reportId: string;
  format: ReportFormat;
}

// ─── Settings ───────────────────────────────────────────────────────────────
export interface SmtpSettings {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  from: string;
  envConfigured: boolean;
}

export interface RemediationSettings {
  enabled: boolean;
  providerType: "project" | ProviderType;
  providerConfig: RedactedProviderConfig;
}

export interface ModelOption {
  id: string;
  name: string;
}

export interface ModelsResponse {
  models: ModelOption[];
  error?: string;
}

export interface ProviderTestResponse {
  success: boolean;
  error?: string;
}

// ─── Connectivity ───────────────────────────────────────────────────────────
export interface ConnectivityCheck {
  reachable: boolean;
  latencyMs: number;
  models?: string[];
  error?: string;
  suggestion?: string;
  dockerResolved?: boolean;
}
