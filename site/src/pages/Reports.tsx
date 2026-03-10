import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, Download, Clock, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { downloadFile } from "@/lib/downloadFile";

export default function Reports() {
  const { data: scans = [] } = useQuery({
    queryKey: ["scans"],
    queryFn: () => api.get("/scans").then((r) => (r.data as any[]).filter((s: any) => s.status === "completed")),
  });

  const [reportError, setReportError] = useState<string | null>(null);

  const generateReport = async (scanId: string, format: "pdf" | "json") => {
    try {
      setReportError(null);
      const res = await api.post(`/reports/${scanId}/generate`, { format });
      await downloadFile(
        `/reports/${scanId}/download/${res.data.reportId}`,
        `eart-report-${scanId.slice(0, 8)}.${format}`
      );
    } catch (err: any) {
      setReportError(err?.response?.data?.error ?? `Failed to generate ${format.toUpperCase()} report`);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Generate and download PDF security reports for completed scans
        </p>
      </div>

      {reportError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{reportError}</AlertDescription>
        </Alert>
      )}

      {scans.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">No completed scans</p>
              <p className="text-sm text-muted-foreground">
                Run a scan first to generate reports
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {scans.map((scan: any) => (
            <Card key={scan.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{scan.projectName ?? scan.projectId?.slice(0, 8)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-xs">
                        {scan.preset ?? "custom"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {scan.totalTests} tests · {scan.failedTests} failed
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateReport(scan.id, "json")}
                  >
                    JSON
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => generateReport(scan.id, "pdf")}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    PDF Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
