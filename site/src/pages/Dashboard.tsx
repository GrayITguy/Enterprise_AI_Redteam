import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, ReferenceLine,
} from "recharts";
import {
  Shield, AlertTriangle, Clock, FolderOpen,
  ChevronRight, CalendarClock, TrendingUp, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  NEON_RED, NEON_CYAN, NEON_ORANGE,
  FONT_DISPLAY, FONT_UI,
  cyberCardStyle, TOOLTIP_STYLE,
  primaryButtonStyle, PRIMARY_BUTTON_HOVER_SHADOW, PRIMARY_BUTTON_SHADOW,
} from "@/lib/theme";

/* ── Cyberpunk color palette ─────────────────────────────────────────── */
const SEVERITY_COLORS = {
  Critical: NEON_RED,
  High:     "#FF4D1A",
  Medium:   NEON_ORANGE,
  Low:      "#4ADE80",
};

const DONUT_COLORS = {
  Completed: NEON_CYAN,
  Running:   NEON_ORANGE,
  Failed:    NEON_RED,
};

/* ── Status badge styles ─────────────────────────────────────────────── */
function ScanStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; shadow?: string }> = {
    completed: { bg: "rgba(0,240,255,0.1)",  color: "#00F0FF", shadow: "0 0 8px rgba(0,240,255,0.35)" },
    running:   { bg: "rgba(255,140,26,0.1)", color: "#FF8C1A", shadow: "0 0 8px rgba(255,140,26,0.35)" },
    failed:    { bg: "rgba(255,26,60,0.12)", color: "#FF1A3C", shadow: "0 0 8px rgba(255,26,60,0.45)" },
    pending:   { bg: "rgba(255,255,255,0.05)", color: "#888" },
    cancelled: { bg: "rgba(255,255,255,0.05)", color: "#666" },
  };
  const s = styles[status] ?? styles.cancelled;
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest"
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.color}30`,
        boxShadow: s.shadow,
        fontFamily: "'Rajdhani', sans-serif",
      }}
    >
      {status}
    </span>
  );
}

/* ── Stat card ───────────────────────────────────────────────────────── */
function StatCard({
  title, value, icon: Icon, description, glowVariant,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  description?: string;
  glowVariant?: "red-glow" | "cyan" | "none";
}) {
  const isRedGlow = glowVariant === "red-glow";
  const isCyan    = glowVariant === "cyan";

  return (
    <div
      className="relative overflow-hidden rounded-lg p-4 scanline-hover"
      style={{
        background: "rgba(12, 12, 12, 0.88)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: isRedGlow
          ? "1px solid #FF1A3C"
          : isCyan
          ? "1px solid rgba(0,240,255,0.35)"
          : "1px solid rgba(255,26,60,0.2)",
        boxShadow: isRedGlow
          ? "0 0 16px rgba(255,26,60,0.4), 0 0 32px rgba(255,26,60,0.15), inset 0 0 20px rgba(255,26,60,0.05)"
          : isCyan
          ? "0 0 12px rgba(0,240,255,0.2), inset 0 0 15px rgba(0,240,255,0.03)"
          : "inset 0 0 15px rgba(255,26,60,0.03)",
        animation: isRedGlow ? "border-flicker 8s ease-in-out infinite" : undefined,
      }}
    >
      {/* Corner accent */}
      <div
        className="absolute top-0 right-0 w-8 h-8 opacity-60"
        style={{
          background: isRedGlow
            ? "linear-gradient(225deg, rgba(255,26,60,0.25) 0%, transparent 70%)"
            : isCyan
            ? "linear-gradient(225deg, rgba(0,240,255,0.15) 0%, transparent 70%)"
            : "linear-gradient(225deg, rgba(255,26,60,0.1) 0%, transparent 70%)",
        }}
      />

      <div className="flex items-center justify-between pb-2">
        <p
          className="text-xs font-medium uppercase tracking-widest"
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            color: isRedGlow ? "rgba(255,26,60,0.7)" : isCyan ? "rgba(0,240,255,0.6)" : "rgba(255,255,255,0.4)",
          }}
        >
          {title}
        </p>
        <Icon
          className="h-4 w-4 shrink-0"
          style={{
            color: isRedGlow ? "#FF1A3C" : isCyan ? "#00F0FF" : "rgba(255,255,255,0.3)",
          }}
        />
      </div>

      <div
        className="text-3xl font-bold text-white"
        style={{
          fontFamily: "'Orbitron', sans-serif",
          color: isRedGlow ? "#FF1A3C" : isCyan ? "#00F0FF" : "#ffffff",
          textShadow: isRedGlow
            ? "0 0 20px rgba(255,26,60,0.6)"
            : isCyan
            ? "0 0 20px rgba(0,240,255,0.5)"
            : "none",
        }}
      >
        {value}
      </div>

      {description && (
        <p
          className="text-xs mt-1"
          style={{
            fontFamily: "'Rajdhani', sans-serif",
            color: isRedGlow ? "rgba(255,26,60,0.5)" : "rgba(255,255,255,0.3)",
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}

/* ── Cyberpunk card wrapper ──────────────────────────────────────────── */
function CyberCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg overflow-hidden ${className}`}
      style={cyberCardStyle}
    >
      {children}
    </div>
  );
}

function CyberCardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-4"
      style={{ borderBottom: "1px solid rgba(255,26,60,0.12)" }}
    >
      {children}
    </div>
  );
}

function CyberCardTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && (
        <Icon className="h-4 w-4" style={{ color: "rgba(255,26,60,0.55)" }} />
      )}
      <span
        className="text-sm font-semibold uppercase tracking-widest"
        style={{ fontFamily: FONT_UI, color: "rgba(255,255,255,0.7)" }}
      >
        {children}
      </span>
    </div>
  );
}

/* ── Main dashboard ──────────────────────────────────────────────────── */
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

  const { data: history } = useQuery({
    queryKey: ["scan-history"],
    queryFn: () => api.get("/scans/history").then((r) => r.data as any[]),
    refetchInterval: 60_000,
  });

  const { data: upcoming } = useQuery({
    queryKey: ["scans-upcoming"],
    queryFn: () => api.get("/scans/upcoming").then((r) => r.data as any[]),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: "#FF1A3C", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const completedScans = (scans ?? []).filter((s) => s.status === "completed");
  const runningScans   = (scans ?? []).filter((s) => s.status === "running");
  const failedScans    = (scans ?? []).filter((s: any) => s.status === "failed");
  const totalFailed    = completedScans.reduce((sum: number, s: any) => sum + s.failedTests, 0);

  const passRate = completedScans.length > 0
    ? Math.round(
        completedScans.reduce(
          (s: number, sc: any) => s + (sc.totalTests > 0 ? sc.passedTests / sc.totalTests : 0),
          0,
        ) / completedScans.length * 100,
      )
    : 0;

  const severityData = [
    { name: "Critical", count: stats?.critical ?? 0, fill: SEVERITY_COLORS.Critical },
    { name: "High",     count: stats?.high     ?? 0, fill: SEVERITY_COLORS.High },
    { name: "Medium",   count: stats?.medium   ?? 0, fill: SEVERITY_COLORS.Medium },
    { name: "Low",      count: stats?.low      ?? 0, fill: SEVERITY_COLORS.Low },
  ];

  const donutData = [
    { name: "Completed", value: completedScans.length || 1 },
    { name: "Running",   value: runningScans.length },
    { name: "Failed",    value: failedScans.length },
  ].filter((d) => d.value > 0);

  const trendData = (history ?? []).map((s: any, i: number) => ({
    label: s.completedAt ? format(new Date(s.completedAt), "MM/dd") : `#${i + 1}`,
    passed:   s.passedTests ?? 0,
    failed:   s.failedTests ?? 0,
    passRate: s.totalTests > 0 ? Math.round((s.passedTests / s.totalTests) * 100) : 0,
  }));

  return (
    <div
      className="space-y-6 p-6 min-h-screen font-rajdhani"
      style={{ fontFamily: "'Rajdhani', system-ui, sans-serif" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold tracking-widest text-white uppercase"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: "0.15em" }}
          >
            Security Dashboard
          </h1>
          <p
            className="text-sm mt-0.5 tracking-wider"
            style={{ color: "rgba(255,26,60,0.55)", fontFamily: "'Rajdhani', sans-serif" }}
          >
            AI model vulnerability overview
          </p>
        </div>

        <Link to="/scans/new">
          <button
            className="flex items-center gap-2 rounded px-4 py-2 text-white font-bold uppercase tracking-widest text-sm transition-all"
            style={primaryButtonStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = PRIMARY_BUTTON_HOVER_SHADOW;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = PRIMARY_BUTTON_SHADOW;
            }}
          >
            <Zap className="h-4 w-4" />
            New Scan
          </button>
        </Link>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
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
          glowVariant={runningScans.length > 0 ? "cyan" : "none"}
        />
        <StatCard
          title="Total Findings"
          value={totalFailed}
          icon={AlertTriangle}
          glowVariant="red-glow"
          description={`${passRate}% pass rate`}
        />
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Findings by Severity */}
        <CyberCard>
          <CyberCardHeader>
            <CyberCardTitle>Findings by Severity</CyberCardTitle>
          </CyberCardHeader>
          <div className="p-5 pt-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={severityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,26,60,0.08)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)", fontFamily: "'Rajdhani',sans-serif" }}
                  axisLine={{ stroke: "rgba(255,26,60,0.15)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)", fontFamily: "'Rajdhani',sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,26,60,0.06)" }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {severityData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.fill}
                      style={
                        entry.name === "Critical"
                          ? { filter: "drop-shadow(0 0 6px #FF1A3C) drop-shadow(0 0 12px rgba(255,26,60,0.5))" }
                          : undefined
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CyberCard>

        {/* Scan Status Donut */}
        <CyberCard>
          <CyberCardHeader>
            <CyberCardTitle>Scan Status Distribution</CyberCardTitle>
          </CyberCardHeader>
          <div className="p-5 pt-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={82}
                  dataKey="value"
                  strokeWidth={0}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  <Cell
                    fill={DONUT_COLORS.Completed}
                    style={{ filter: "drop-shadow(0 0 8px #00F0FF) drop-shadow(0 0 18px rgba(0,240,255,0.5))" }}
                  />
                  <Cell fill={DONUT_COLORS.Running} />
                  <Cell fill={DONUT_COLORS.Failed} />
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: any, name: any) => [v, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CyberCard>
      </div>

      {/* ── Trend + Upcoming ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* Pass-Rate Trend */}
        <CyberCard className="lg:col-span-2">
          <CyberCardHeader>
            <CyberCardTitle icon={TrendingUp}>Pass-Rate Trend (last 30 scans)</CyberCardTitle>
          </CyberCardHeader>
          <div className="p-5 pt-4">
            {trendData.length === 0 ? (
              <div
                className="flex h-[180px] items-center justify-center text-sm"
                style={{ color: "rgba(255,255,255,0.25)", fontFamily: "'Rajdhani',sans-serif" }}
              >
                No completed scans yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,26,60,0.07)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.35)", fontFamily: "'Rajdhani',sans-serif" }}
                    axisLine={{ stroke: "rgba(255,26,60,0.15)" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 100]}
                    unit="%"
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.35)", fontFamily: "'Rajdhani',sans-serif" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v: any) => [`${v}%`, "Pass Rate"]}
                  />
                  <ReferenceLine
                    y={80}
                    stroke="rgba(255,26,60,0.4)"
                    strokeDasharray="4 4"
                    label={{ value: "80%", fill: "rgba(255,26,60,0.5)", fontSize: 10, fontFamily: "'Rajdhani'" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="passRate"
                    stroke="#00F0FF"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#00F0FF", strokeWidth: 0, filter: "drop-shadow(0 0 4px #00F0FF)" }}
                    activeDot={{ r: 5, fill: "#00F0FF", filter: "drop-shadow(0 0 8px #00F0FF)" }}
                    style={{ filter: "drop-shadow(0 0 3px rgba(0,240,255,0.5))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </CyberCard>

        {/* Upcoming Scans */}
        <CyberCard>
          <CyberCardHeader>
            <CyberCardTitle icon={CalendarClock}>Upcoming Scans</CyberCardTitle>
          </CyberCardHeader>
          <div className="p-4">
            {(upcoming ?? []).length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CalendarClock
                  className="h-8 w-8"
                  style={{ color: "rgba(255,26,60,0.25)" }}
                />
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.25)", fontFamily: "'Rajdhani',sans-serif" }}>
                  No scheduled scans
                </p>
                <Link to="/scans/new">
                  <button
                    className="rounded px-3 py-1 text-xs font-semibold uppercase tracking-widest transition-all"
                    style={{
                      border: "1px solid rgba(255,26,60,0.3)",
                      color: "rgba(255,26,60,0.6)",
                      background: "transparent",
                      fontFamily: "'Rajdhani',sans-serif",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = "#FF1A3C";
                      (e.currentTarget as HTMLElement).style.color = "#FF1A3C";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,26,60,0.3)";
                      (e.currentTarget as HTMLElement).style.color = "rgba(255,26,60,0.6)";
                    }}
                  >
                    Schedule one
                  </button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {(upcoming ?? []).map((s: any) => (
                  <div
                    key={s.id}
                    className="flex items-start justify-between rounded p-2.5 text-sm scanline-hover"
                    style={{
                      border: "1px solid rgba(255,26,60,0.15)",
                      background: "rgba(255,26,60,0.03)",
                    }}
                  >
                    <div className="min-w-0">
                      <p
                        className="font-medium truncate text-gray-200"
                        style={{ fontFamily: "'Rajdhani',sans-serif" }}
                      >
                        {s.projectName ?? s.projectId?.slice(0, 8)}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Rajdhani',sans-serif" }}
                      >
                        {s.scheduledAt ? format(new Date(s.scheduledAt), "MMM d, HH:mm") : "—"}
                      </p>
                    </div>
                    {s.recurrence && (
                      <span
                        className="capitalize text-[10px] font-bold rounded px-1.5 py-0.5 uppercase tracking-wider shrink-0 ml-2"
                        style={{
                          background: "rgba(255,140,26,0.1)",
                          color: "#FF8C1A",
                          border: "1px solid rgba(255,140,26,0.25)",
                          fontFamily: "'Rajdhani',sans-serif",
                        }}
                      >
                        {s.recurrence}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CyberCard>
      </div>

      {/* ── Recent Scans ─────────────────────────────────────────────────── */}
      <CyberCard>
        <CyberCardHeader>
          <CyberCardTitle>Recent Scans</CyberCardTitle>
          <Link to="/scans/new">
            <button
              className="rounded px-3 py-1 text-xs font-bold uppercase tracking-widest transition-all"
              style={{
                border: "1px solid rgba(255,26,60,0.3)",
                color: "rgba(255,26,60,0.6)",
                background: "transparent",
                fontFamily: "'Rajdhani',sans-serif",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#FF1A3C";
                (e.currentTarget as HTMLElement).style.color = "#FF1A3C";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px rgba(255,26,60,0.3)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,26,60,0.3)";
                (e.currentTarget as HTMLElement).style.color = "rgba(255,26,60,0.6)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              New Scan
            </button>
          </Link>
        </CyberCardHeader>

        <div className="p-4 space-y-1.5">
          {(scans ?? []).slice(0, 8).map((scan: any) => (
            <div
              key={scan.id}
              className="flex items-center justify-between rounded px-4 py-3 transition-all scanline-hover"
              style={{
                border: "1px solid rgba(255,26,60,0.1)",
                background: "rgba(255,26,60,0.02)",
              }}
            >
              <div className="flex items-center gap-3">
                <ScanStatusBadge status={scan.status} />
                <div>
                  <p
                    className="text-sm font-semibold text-gray-200"
                    style={{ fontFamily: "'Rajdhani',sans-serif" }}
                  >
                    {scan.projectName ?? scan.projectId?.slice(0, 8)}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Rajdhani',sans-serif" }}
                  >
                    {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {scan.status === "completed" && (
                  <div className="text-right">
                    <p
                      className="text-sm font-bold"
                      style={{ color: "#FF1A3C", fontFamily: "'Orbitron',sans-serif", fontSize: "12px" }}
                    >
                      {scan.failedTests} failed
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'Rajdhani',sans-serif" }}
                    >
                      of {scan.totalTests} tests
                    </p>
                  </div>
                )}
                <Link to={`/scans/${scan.id}/results`}>
                  <button
                    className="rounded p-1.5 transition-all"
                    style={{ color: "rgba(255,26,60,0.4)", background: "transparent" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "#FF1A3C";
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,26,60,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "rgba(255,26,60,0.4)";
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </Link>
              </div>
            </div>
          ))}

          {(scans ?? []).length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Shield
                className="h-12 w-12"
                style={{ color: "rgba(255,26,60,0.2)", filter: "drop-shadow(0 0 8px rgba(255,26,60,0.2))" }}
              />
              <p
                className="text-sm"
                style={{ color: "rgba(255,255,255,0.25)", fontFamily: "'Rajdhani',sans-serif" }}
              >
                No scans yet.
              </p>
              <Link to="/scans/new">
                <button
                  className="rounded px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition-all"
                  style={{
                    background: "#FF1A3C",
                    fontFamily: "'Rajdhani',sans-serif",
                    boxShadow: "0 0 15px rgba(255,26,60,0.5)",
                  }}
                >
                  Run Your First Scan
                </button>
              </Link>
            </div>
          )}
        </div>
      </CyberCard>
    </div>
  );
}
