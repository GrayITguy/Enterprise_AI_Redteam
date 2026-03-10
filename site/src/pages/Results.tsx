import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/downloadFile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { Download, Filter, ChevronDown, ChevronRight, Shield, Sparkles, AlertCircle, Wrench } from "lucide-react";
import { useState } from "react";
import { SEVERITY_ORDER, SEVERITY_COLORS, OWASP_NAMES } from "@/lib/constants";

function FindingRow({ result }: { result: any }) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLORS[result.severity] ?? "#6b7280";
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`${result.severity} ${result.testName} - ${result.passed ? "passed" : "failed"}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge
            variant="outline"
            style={{ borderColor: color, color }}
            className="shrink-0 uppercase text-[10px]"
          >
            {result.severity}
          </Badge>
          <span className="text-sm font-medium truncate">{result.testName}</span>
          <Badge variant="secondary" className="shrink-0 text-xs capitalize hidden sm:flex">
            {result.tool}
          </Badge>
          {result.owaspCategory && (
            <Badge variant="outline" className="shrink-0 text-xs hidden md:flex">
              {result.owaspCategory}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-bold ${result.passed ? "text-green-500" : "text-red-500"}`}>
            {result.passed ? "PASS" : "FAIL"}
          </span>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {expanded && (
        <div className="border-t bg-muted/20 p-4 space-y-3">
          {result.prompt && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Attack Prompt</p>
              <pre className="text-xs bg-background rounded p-2 overflow-x-auto whitespace-pre-wrap border">{result.prompt}</pre>
            </div>
          )}
          {result.response && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Model Response</p>
              <pre className="text-xs bg-background rounded p-2 overflow-x-auto whitespace-pre-wrap border">{result.response}</pre>
            </div>
          )}
          {result.evidence && Object.keys(result.evidence).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Evidence</p>
              <pre className="text-xs bg-background rounded p-2 overflow-x-auto border">{JSON.stringify(result.evidence, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Results() {
  const { id: scanId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showFailedOnly, setShowFailedOnly] = useState(true);

  const [narrative, setNarrative] = useState<string | null>(null);

  const { data: scan } = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => api.get(`/scans/${scanId}`).then((r) => r.data as any),
  });

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["scan-results", scanId],
    queryFn: () => api.get(`/scans/${scanId}/results`).then((r) => r.data as any[]),
    refetchInterval: scan?.status === "running" ? 5000 : false,
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      api.post(`/reports/${scanId}/generate`, { format: "pdf" }),
    onSuccess: async (res) => {
      const { reportId } = res.data;
      await downloadFile(
        `/reports/${scanId}/download/${reportId}`,
        `eart-report-${scanId!.slice(0, 8)}.pdf`
      );
    },
  });

  const narrativeMutation = useMutation({
    mutationFn: () =>
      api.post(`/results/scans/${scanId}/narrative`).then((r) => r.data as { narrative: string }),
    onSuccess: (data) => setNarrative(data.narrative),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const bySeverity = ["critical", "high", "medium", "low", "info"].map((sev) => ({
    name: sev.charAt(0).toUpperCase() + sev.slice(1),
    count: results.filter((r: any) => r.severity === sev && !r.passed).length,
    fill: SEVERITY_COLORS[sev],
  }));

  const byTool = ["promptfoo", "garak", "pyrit", "deepteam"].map((tool) => {
    const tr = results.filter((r: any) => r.tool === tool);
    return { tool, total: tr.length, failed: tr.filter((r: any) => !r.passed).length };
  }).filter((t) => t.total > 0);

  const owaspData = Object.keys(OWASP_NAMES).map((cat) => {
    const catResults = results.filter((r: any) => r.owaspCategory === cat);
    const failRate = catResults.length > 0
      ? Math.round((catResults.filter((r: any) => !r.passed).length / catResults.length) * 100)
      : 0;
    return { category: cat, fullName: OWASP_NAMES[cat], failRate };
  });

  const filtered = results
    .filter((r: any) => severityFilter === "all" || r.severity === severityFilter)
    .filter((r: any) => !showFailedOnly || !r.passed)
    .sort((a: any, b: any) =>
      (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4)
    );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scan Results</h1>
          <p className="text-sm text-muted-foreground">
            {scan?.projectName} · {results.length} tests
            {scan?.status === "running" && " · updating live"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            onClick={() => navigate(`/scans/${scanId}/remediate`)}
            disabled={scan?.status !== "completed" || results.filter((r: any) => !r.passed).length === 0}
          >
            <Wrench className="mr-2 h-4 w-4" />
            Remediate
          </Button>
          <Button
            variant="outline"
            onClick={() => reportMutation.mutate()}
            disabled={reportMutation.isPending || scan?.status !== "completed"}
          >
            <Download className="mr-2 h-4 w-4" />
            {reportMutation.isPending ? "Generating..." : "Export PDF"}
          </Button>
        </div>
      </div>

      {/* Severity summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {bySeverity.map((s) => (
          <Card
            key={s.name}
            className="cursor-pointer transition-colors"
            style={{ borderColor: severityFilter === s.name.toLowerCase() ? s.fill : undefined }}
            onClick={() => setSeverityFilter(
              severityFilter === s.name.toLowerCase() ? "all" : s.name.toLowerCase()
            )}
          >
            <CardContent className="p-4">
              <p className="text-2xl font-bold" style={{ color: s.fill }}>{s.count}</p>
              <p className="text-xs text-muted-foreground">{s.name}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* AI Summary Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Executive Summary
            </CardTitle>
            {!narrative && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => narrativeMutation.mutate()}
                disabled={narrativeMutation.isPending || scan?.status !== "completed"}
              >
                {narrativeMutation.isPending ? (
                  <>
                    <div className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-3 w-3" />
                    Generate
                  </>
                )}
              </Button>
            )}
            {narrative && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setNarrative(null); narrativeMutation.reset(); }}
              >
                Regenerate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {narrative ? (
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{narrative}</p>
          ) : narrativeMutation.isError ? (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {(narrativeMutation.error as any)?.response?.data?.error ?? "Failed to generate summary"}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {scan?.status !== "completed"
                ? "Available once the scan completes."
                : "Click \u201cGenerate\u201d to produce an LLM-powered executive narrative from these results."}
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">Findings ({filtered.length})</TabsTrigger>
          <TabsTrigger value="charts">Tool Analysis</TabsTrigger>
          <TabsTrigger value="owasp">OWASP Coverage</TabsTrigger>
        </TabsList>

        {/* Findings */}
        <TabsContent value="findings" className="space-y-3 mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {["all", "critical", "high", "medium", "low"].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={severityFilter === s ? "default" : "outline"}
                onClick={() => setSeverityFilter(s)}
                className="capitalize"
              >
                {s}
              </Button>
            ))}
            <Button
              size="sm"
              variant={showFailedOnly ? "default" : "outline"}
              onClick={() => setShowFailedOnly(!showFailedOnly)}
              className="ml-auto"
            >
              Failures only
            </Button>
          </div>
          <div className="space-y-2">
            {filtered.map((result: any) => (
              <FindingRow key={result.id} result={result} />
            ))}
            {filtered.length === 0 && (
              <div className="rounded-lg border border-dashed p-12 text-center">
                <Shield className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No findings match the current filters.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tool charts */}
        <TabsContent value="charts" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Findings by Tool</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byTool}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="tool" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                    <Bar dataKey="failed" name="Failed" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total" name="Total" fill="#374151" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Severity Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={bySeverity} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={70} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {bySeverity.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* OWASP radar */}
        <TabsContent value="owasp" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">OWASP LLM Top 10 Risk Radar</CardTitle></CardHeader>
            <CardContent className="flex justify-center">
              <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={owaspData} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} tickCount={5} />
                  <Radar
                    name="Fail Rate %"
                    dataKey="failRate"
                    stroke="#dc2626"
                    fill="#dc2626"
                    fillOpacity={0.25}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                    formatter={(value: any, _name: any, props: any) => [
                      `${value}%`,
                      `${props.payload.fullName}`,
                    ]}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
