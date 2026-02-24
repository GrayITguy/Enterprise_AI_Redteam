import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, Clock, AlertTriangle, ChevronRight } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  completed: "default",
  running: "secondary",
  failed: "destructive",
  pending: "outline",
  cancelled: "outline",
};

export default function ScanDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: scan, isLoading } = useQuery({
    queryKey: ["scan", id],
    queryFn: () => api.get(`/scans/${id}`).then((r) => r.data as any),
    refetchInterval: (query) => {
      const scanData = query.state.data as { status?: string } | undefined;
      return scanData && !["completed", "failed", "cancelled"].includes(scanData.status ?? "")
        ? 3000
        : false;
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Scan not found</p>
      </div>
    );
  }

  const progress = scan.totalTests > 0
    ? Math.round((scan.passedTests + scan.failedTests) / scan.totalTests * 100)
    : scan.status === "completed" ? 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scan Progress</h1>
          <p className="text-sm text-muted-foreground">
            {scan.projectName ?? scan.projectId?.slice(0, 8)}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[scan.status] ?? "outline"} className="text-sm px-3 py-1">
          {scan.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {scan.status === "running" ? "Running tests..." :
             scan.status === "pending" ? "Queued — waiting for worker..." :
             scan.status === "completed" ? "Scan complete" :
             scan.status === "failed" ? "Scan failed" : "Scan cancelled"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {scan.status !== "pending" && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-center">
              <div className="text-2xl font-bold">{scan.totalTests}</div>
              <div className="text-xs text-muted-foreground">Total Tests</div>
            </div>
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-center">
              <div className="text-2xl font-bold text-green-500">{scan.passedTests}</div>
              <div className="text-xs text-muted-foreground">Passed</div>
            </div>
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center">
              <div className="text-2xl font-bold text-red-500">{scan.failedTests}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
          </div>

          {scan.errorMessage && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-sm font-medium text-destructive">Error</p>
              <p className="text-xs text-muted-foreground mt-1">{scan.errorMessage}</p>
            </div>
          )}

          {scan.preset && (
            <div className="text-sm text-muted-foreground">
              Preset: <span className="font-medium capitalize">{scan.preset}</span>
              {" · "}{Array.isArray(scan.plugins) ? scan.plugins.length : 0} plugins
            </div>
          )}
        </CardContent>
      </Card>

      {scan.status === "completed" && (
        <Button asChild className="w-full" size="lg">
          <Link to={`/scans/${id}/results`}>
            View Full Results
            <ChevronRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      )}

      {scan.status === "running" && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Running security tests — this page updates automatically
        </div>
      )}
    </div>
  );
}
