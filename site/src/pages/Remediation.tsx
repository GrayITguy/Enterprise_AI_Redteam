import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Shield, Sparkles, AlertCircle, ChevronDown, ChevronRight,
  Copy, Check, RefreshCw, ArrowLeft, Wrench, Target, ClipboardList,
} from "lucide-react";
import { useState } from "react";

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#dc2626",
  P1: "#ea580c",
  P2: "#d97706",
  P3: "#65a30d",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#65a30d",
};

interface RemediationCategory {
  owaspId: string;
  owaspName: string;
  severity: string;
  findingCount: number;
  rootCause: string;
  remediation: string[];
  systemPromptFix: string | null;
  guardrailConfig: string | null;
  priority: string;
}

interface RemediationPlan {
  riskScore: number;
  summary: string;
  categories: RemediationCategory[];
  systemPromptRecommendation: string | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleCopy}
      className="h-7 gap-1.5 text-xs"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-500" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Copy
        </>
      )}
    </Button>
  );
}

function RiskGauge({ score }: { score: number }) {
  const riskLevel =
    score >= 76 ? "Critical" : score >= 51 ? "High" : score >= 26 ? "Moderate" : "Low";
  const riskColor =
    score >= 76
      ? "#dc2626"
      : score >= 51
        ? "#ea580c"
        : score >= 26
          ? "#d97706"
          : "#65a30d";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50" cy="50" r="42"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="8"
          />
          <circle
            cx="50" cy="50" r="42"
            fill="none"
            stroke={riskColor}
            strokeWidth="8"
            strokeDasharray={`${(score / 100) * 264} 264`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color: riskColor }}>
            {score}
          </span>
          <span className="text-[10px] text-muted-foreground">/ 100</span>
        </div>
      </div>
      <Badge
        variant="outline"
        style={{ borderColor: riskColor, color: riskColor }}
        className="text-xs"
      >
        {riskLevel} Risk
      </Badge>
    </div>
  );
}

function CategoryCard({ category }: { category: RemediationCategory }) {
  const [expanded, setExpanded] = useState(false);
  const priorityColor = PRIORITY_COLORS[category.priority] ?? "#6b7280";
  const severityColor = SEVERITY_COLORS[category.severity] ?? "#6b7280";

  return (
    <Card className="overflow-hidden">
      <button
        className="w-full text-left"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                style={{ borderColor: priorityColor, color: priorityColor }}
                className="text-[10px] font-bold"
              >
                {category.priority}
              </Badge>
              <Badge
                variant="outline"
                style={{ borderColor: severityColor, color: severityColor }}
                className="text-[10px] uppercase"
              >
                {category.severity}
              </Badge>
              <CardTitle className="text-sm">
                {category.owaspId} — {category.owaspName}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {category.findingCount} finding{category.findingCount !== 1 ? "s" : ""}
              </span>
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {/* Always show root cause */}
      <CardContent className="pt-0 pb-3">
        <p className="text-sm text-muted-foreground">{category.rootCause}</p>
      </CardContent>

      {expanded && (
        <CardContent className="border-t bg-muted/20 space-y-4 pt-4">
          {/* Remediation steps */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Wrench className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">Remediation Steps</h4>
            </div>
            <ol className="space-y-2 ml-5 list-decimal">
              {category.remediation.map((step, i) => (
                <li key={i} className="text-sm text-muted-foreground pl-1">
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* System prompt fix */}
          {category.systemPromptFix && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">System Prompt Addition</h4>
                </div>
                <CopyButton text={category.systemPromptFix} />
              </div>
              <pre className="text-xs bg-background rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-primary/20 text-foreground">
                {category.systemPromptFix}
              </pre>
            </div>
          )}

          {/* Guardrail config */}
          {category.guardrailConfig && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Guardrail Configuration</h4>
                </div>
                <CopyButton text={category.guardrailConfig} />
              </div>
              <pre className="text-xs bg-background rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-primary/20 text-foreground">
                {category.guardrailConfig}
              </pre>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function Remediation() {
  const { id: scanId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<RemediationPlan | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);

  const { data: scan } = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => api.get(`/scans/${scanId}`).then((r) => r.data as any),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api
        .post(`/remediation/scans/${scanId}/generate`)
        .then((r) => r.data as { plan: RemediationPlan }),
    onSuccess: (data) => setPlan(data.plan),
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      api
        .post(`/remediation/scans/${scanId}/verify`)
        .then((r) => r.data as { id: string }),
    onSuccess: (data) => navigate(`/scans/${data.id}`),
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/scans/${scanId}/results`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              Remediation Advisor
            </h1>
            <p className="text-sm text-muted-foreground">
              {scan?.projectName} — AI-powered fix recommendations
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plan && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${verifyMutation.isPending ? "animate-spin" : ""}`}
              />
              {verifyMutation.isPending ? "Launching..." : "Verify Fixes"}
            </Button>
          )}
        </div>
      </div>

      {/* Generate / regenerate */}
      {!plan && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-1">
                Generate Remediation Plan
              </h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Our AI analyzes your scan&apos;s failed findings and generates
                specific, actionable guidance: system prompt hardening, guardrail
                configurations, and prioritized fix steps.
              </p>
            </div>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={
                generateMutation.isPending || scan?.status !== "completed"
              }
              className="gap-2"
            >
              {generateMutation.isPending ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Analyzing findings...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Plan
                </>
              )}
            </Button>
            {generateMutation.isError && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {(generateMutation.error as any)?.response?.data?.error ??
                    "Failed to generate remediation plan"}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Remediation Plan */}
      {plan && (
        <>
          {/* Overview row */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Risk score */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Overall Risk Score</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center pb-4">
                <RiskGauge score={plan.riskScore} />
              </CardContent>
            </Card>

            {/* Summary */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Assessment Summary
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPlan(null);
                      generateMutation.reset();
                    }}
                  >
                    Regenerate
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {plan.summary}
                </p>
                <div className="flex gap-4 mt-4">
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">
                      {plan.categories.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Categories
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-red-500">
                      {plan.categories.filter((c) => c.priority === "P0").length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Critical (P0)
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-orange-500">
                      {plan.categories.filter((c) => c.priority === "P1").length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      High (P1)
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Categories */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              Remediation by Category
            </h2>
            <div className="space-y-3">
              {plan.categories.map((cat, i) => (
                <CategoryCard key={i} category={cat} />
              ))}
            </div>
          </div>

          {/* Hardened system prompt */}
          {plan.systemPromptRecommendation && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    Recommended Hardened System Prompt
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <CopyButton text={plan.systemPromptRecommendation} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPromptExpanded((e) => !e)}
                    >
                      {promptExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  A production-ready system prompt incorporating all recommended
                  security hardening. Copy and apply to your model configuration.
                </p>
              </CardHeader>
              {promptExpanded && (
                <CardContent>
                  <pre className="text-sm bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap border border-primary/30 leading-relaxed">
                    {plan.systemPromptRecommendation}
                  </pre>
                </CardContent>
              )}
            </Card>
          )}

          {/* Verify action */}
          <Card className="border-primary/30">
            <CardContent className="py-6 flex items-center justify-between">
              <div>
                <h3 className="font-semibold mb-1">Ready to verify?</h3>
                <p className="text-sm text-muted-foreground">
                  After applying the recommended fixes, re-run only the failed
                  tests to confirm your model&apos;s defenses have improved.
                </p>
              </div>
              <Button
                onClick={() => verifyMutation.mutate()}
                disabled={verifyMutation.isPending}
                className="gap-2 shrink-0"
              >
                <RefreshCw
                  className={`h-4 w-4 ${verifyMutation.isPending ? "animate-spin" : ""}`}
                />
                {verifyMutation.isPending
                  ? "Launching verification scan..."
                  : "Run Verification Scan"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
