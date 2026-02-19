import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { Shield, AlertTriangle, CheckCircle, Clock, FolderOpen, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

const SEVERITY_COLORS = {
  Critical: "#dc2626",
  High: "#ea580c",
  Medium: "#d97706",
  Low: "#65a30d",
};

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  completed: "default",
  running: "secondary",
  failed: "destructive",
  pending: "outline",
  cancelled: "outline",
};

function StatCard({
  title, value, icon: Icon, description, accent,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  description?: string;
  accent?: string;
}) {
  return (
    <Card className={accent ? `border-l-4 ${accent}` : ""}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get("/projects").then((r) => r.data as any[]),
  });

  const { data: scans, isLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: () => api.get("/scans").then((r) => r.data as any[]),
    refetchInterval: 15_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["scan-stats"],
    queryFn: () => api.get("/scans/stats").then((r) => r.data as any),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const completedScans = (scans ?? []).filter((s) => s.status === "completed");
  const runningScans = (scans ?? []).filter((s) => s.status === "running");
  const totalFailed = completedScans.reduce((sum: number, s: any) => sum + s.failedTests, 0);

  const severityData = [
    { name: "Critical", count: stats?.critical ?? 0, fill: SEVERITY_COLORS.Critical },
    { name: "High",     count: stats?.high     ?? 0, fill: SEVERITY_COLORS.High },
    { name: "Medium",   count: stats?.medium   ?? 0, fill: SEVERITY_COLORS.Medium },
    { name: "Low",      count: stats?.low      ?? 0, fill: SEVERITY_COLORS.Low },
  ];

  const passRate = completedScans.length > 0
    ? Math.round(
        completedScans.reduce((s: number, sc: any) => s + (sc.totalTests > 0 ? sc.passedTests / sc.totalTests : 0), 0)
        / completedScans.length * 100
      )
    : 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Security Dashboard</h1>
          <p className="text-sm text-muted-foreground">AI model vulnerability overview</p>
        </div>
        <Button asChild>
          <Link to="/scans/new">
            <Shield className="mr-2 h-4 w-4" />
            New Scan
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Projects"
          value={projects?.length ?? 0}
          icon={FolderOpen}
        />
        <StatCard
          title="Total Scans"
          value={scans?.length ?? 0}
          icon={Shield}
          description={`${completedScans.length} completed`}
        />
        <StatCard
          title="Active Scans"
          value={runningScans.length}
          icon={Clock}
          accent={runningScans.length > 0 ? "border-l-blue-500" : ""}
        />
        <StatCard
          title="Total Findings"
          value={totalFailed}
          icon={AlertTriangle}
          accent={totalFailed > 0 ? "border-l-red-500" : "border-l-green-500"}
          description={`${passRate}% pass rate`}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Findings by Severity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={severityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    color: "hsl(var(--foreground))",
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {severityData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={[
                    { name: "Completed", value: completedScans.length || 1 },
                    { name: "Running", value: runningScans.length },
                    { name: "Failed", value: (scans ?? []).filter((s: any) => s.status === "failed").length },
                  ].filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  <Cell fill="#22c55e" />
                  <Cell fill="#3b82f6" />
                  <Cell fill="#dc2626" />
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent scans */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Scans</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link to="/scans/new">New Scan</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(scans ?? []).slice(0, 8).map((scan: any) => (
              <div
                key={scan.id}
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={STATUS_VARIANT[scan.status] ?? "outline"}>
                    {scan.status}
                  </Badge>
                  <div>
                    <p className="text-sm font-medium">
                      {scan.projectName ?? scan.projectId?.slice(0, 8)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {scan.status === "completed" && (
                    <div className="text-right">
                      <p className="text-sm font-medium text-destructive">
                        {scan.failedTests} failed
                      </p>
                      <p className="text-xs text-muted-foreground">
                        of {scan.totalTests} tests
                      </p>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/scans/${scan.id}/results`}>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
            {(scans ?? []).length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Shield className="h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">No scans yet.</p>
                <Button asChild>
                  <Link to="/scans/new">Run Your First Scan</Link>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
