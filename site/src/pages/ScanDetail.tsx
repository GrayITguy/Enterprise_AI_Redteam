import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { ScanDetail as ScanDetailData } from "@/types/api";
import { apiErrorMessage } from "@/types/api";
import { useScanEvents, type ScanProgressEvent } from "@/hooks/useScanEvents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronRight, Ban } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  completed: "default",
  running: "secondary",
  failed: "destructive",
  pending: "outline",
  cancelled: "outline",
};

export default function ScanDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: scan, isLoading } = useQuery({
    queryKey: ["scan", id],
    queryFn: () => api.get(`/scans/${id}`).then((r) => r.data as ScanDetailData),
    refetchInterval: (query) => {
      const scanData = query.state.data as ScanDetailData | undefined;
      return scanData && !["completed", "failed", "cancelled"].includes(scanData.status ?? "")
        ? 3000
        : false;
    },
  });

  const isActive = !!scan && ["pending", "running"].includes(scan.status);

  // Live progress over SSE — merges into the cached scan so the UI updates
  // instantly; polling above remains the fallback if the stream drops.
  const onProgress = useCallback(
    (e: ScanProgressEvent) => {
      queryClient.setQueryData<ScanDetailData>(["scan", id], (prev) =>
        prev ? { ...prev, status: e.status as ScanDetailData["status"], progress: e.progress,
          totalTests: e.totalTests, passedTests: e.passedTests, failedTests: e.failedTests } : prev
      );
    },
    [queryClient, id]
  );
  const onDone = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["scan", id] });
  }, [queryClient, id]);
  useScanEvents(id, isActive, onProgress, onDone);

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/scans/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scan", id] }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status" aria-label="Loading scan">
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

  const progress = scan.progress != null
    ? scan.progress
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
            <div className="space-y-2" aria-live="polite">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span>{progress}%</span>
              </div>
              <Progress
                value={progress}
                aria-label="Scan progress"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
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

      {isActive && (
        <div className="flex flex-col items-center gap-3">
          {scan.status === "running" && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Running security tests — this page updates live
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            <Ban className="mr-2 h-4 w-4" />
            {cancelMutation.isPending ? "Cancelling…" : "Cancel scan"}
          </Button>
          {cancelMutation.isError && (
            <p className="text-xs text-destructive">
              {apiErrorMessage(cancelMutation.error) ?? "Failed to cancel scan"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
