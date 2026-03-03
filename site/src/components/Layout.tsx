import { useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, FolderOpen, ScanLine,
  FileText, Key, Settings, LogOut, ChevronRight, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects",  label: "Projects",  icon: FolderOpen },
  { href: "/scans/new", label: "New Scan",  icon: ScanLine },
  { href: "/reports",   label: "Reports",   icon: FileText },
  { href: "/license",   label: "License",   icon: Key },
  { href: "/settings",  label: "Settings",  icon: Settings },
];

/* Inline cyberpunk red shield SVG — larger, glowing, holographic */
function CyberpunkShield({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("logo-neon-pulse", className)}
      aria-hidden="true"
    >
      <defs>
        <filter id="sb-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.2" result="blur1" />
          <feGaussianBlur stdDeviation="0.5" result="blur2" />
          <feMerge>
            <feMergeNode in="blur1" />
            <feMergeNode in="blur2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="sb-fill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#200008" />
          <stop offset="100%" stopColor="#080001" />
        </linearGradient>
      </defs>
      {/* Outer shield */}
      <path
        d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V6L12 2z"
        fill="url(#sb-fill)"
        stroke="#FF1A3C"
        strokeWidth="1.3"
        strokeLinejoin="round"
        filter="url(#sb-glow)"
      />
      {/* Inner holographic ring */}
      <path
        d="M12 4.2L5.2 7.6v4.4c0 3.8 2.7 7.2 6.8 8.1 4.1-0.9 6.8-4.3 6.8-8.1V7.6L12 4.2z"
        fill="none"
        stroke="#FF1A3C"
        strokeWidth="0.35"
        opacity="0.4"
      />
      {/* Lightning bolt */}
      <path
        d="M13.1 7.8l-3.1 4.3h2.1l-2.2 4.1 4.9-5.4h-2.3l2.1-3z"
        fill="#FF1A3C"
        filter="url(#sb-glow)"
      />
    </svg>
  );
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();
  const { lastSeenAt, markSeen } = useNotificationStore();

  const { data: scans } = useQuery({
    queryKey: ["scans"],
    queryFn: () => api.get("/scans").then((r) => r.data as any[]),
    refetchInterval: 15_000,
  });

  const newCompletedCount = (scans ?? []).filter((s: any) => {
    if (s.status !== "completed" || !s.completedAt) return false;
    return new Date(s.completedAt).getTime() > lastSeenAt;
  }).length;

  useEffect(() => {
    if (location.pathname === "/dashboard") markSeen();
  }, [location.pathname, markSeen]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#080808" }}>
      {/* ── Cyberpunk Sidebar ─────────────────────────────────────────────── */}
      <aside
        className="flex w-56 shrink-0 flex-col"
        style={{
          background: "linear-gradient(180deg, #0a0002 0%, #080008 50%, #050005 100%)",
          borderRight: "1px solid rgba(255,26,60,0.25)",
          boxShadow: "4px 0 24px rgba(255,26,60,0.08)",
        }}
      >
        {/* ── Logo section ─────────────────────────────────────────── */}
        <div
          className="flex flex-col items-center justify-center gap-1 py-5"
          style={{ borderBottom: "1px solid rgba(255,26,60,0.18)" }}
        >
          <CyberpunkShield className="h-12 w-12 mb-1" />
          <div className="text-center">
            <div
              className="text-sm font-bold tracking-widest text-white uppercase"
              style={{ fontFamily: "'Orbitron', sans-serif", letterSpacing: "0.18em" }}
            >
              AI Red Team
            </div>
            <div
              className="text-[9px] tracking-widest uppercase mt-0.5"
              style={{ color: "rgba(255,26,60,0.55)", fontFamily: "'Rajdhani', sans-serif" }}
            >
              Enterprise Platform
            </div>
          </div>
        </div>

        {/* ── Quick action ─────────────────────────────────────────── */}
        <div className="p-2.5" style={{ borderBottom: "1px solid rgba(255,26,60,0.12)" }}>
          <Button
            asChild
            size="sm"
            className="w-full h-8 gap-1.5 btn-neon-red border-0 text-white"
            style={{
              background: "#FF1A3C",
              boxShadow: "0 0 14px rgba(255,26,60,0.55), 0 0 28px rgba(255,26,60,0.25)",
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 700,
              letterSpacing: "0.12em",
              fontSize: "11px",
              textTransform: "uppercase",
            }}
          >
            <Link to="/scans/new">
              <Zap className="h-3.5 w-3.5" />
              Quick Scan
            </Link>
          </Button>
        </div>

        {/* ── Nav ──────────────────────────────────────────────────── */}
        <nav className="flex-1 space-y-0.5 p-2 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/dashboard"
                ? location.pathname === "/dashboard"
                : location.pathname.startsWith(href);
            const showBadge = href === "/dashboard" && newCompletedCount > 0 && !isActive;

            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  "flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-all duration-200",
                  "font-rajdhani tracking-wide",
                  isActive
                    ? "text-[#FF1A3C]"
                    : "text-gray-500 hover:text-gray-200"
                )}
                style={
                  isActive
                    ? {
                        background: "rgba(255,26,60,0.1)",
                        borderLeft: "2px solid #FF1A3C",
                        boxShadow: "inset 0 0 20px rgba(255,26,60,0.07)",
                        paddingLeft: "10px",
                        fontFamily: "'Rajdhani', sans-serif",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                      }
                    : {
                        borderLeft: "2px solid transparent",
                        fontFamily: "'Rajdhani', sans-serif",
                        fontWeight: 500,
                        letterSpacing: "0.04em",
                      }
                }
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={isActive ? { color: "#FF1A3C" } : {}}
                />
                <span className="flex-1">{label}</span>
                {showBadge && (
                  <span
                    className="flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                    style={{ background: "#FF1A3C", boxShadow: "0 0 8px rgba(255,26,60,0.7)" }}
                  >
                    {newCompletedCount > 9 ? "9+" : newCompletedCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* ── User footer ──────────────────────────────────────────── */}
        <div style={{ borderTop: "1px solid rgba(255,26,60,0.15)" }} className="p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-2 h-10 hover:bg-[rgba(255,26,60,0.06)] text-gray-400 hover:text-gray-200"
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback
                    className="text-[10px] font-bold"
                    style={{
                      background: "rgba(255,26,60,0.15)",
                      color: "#FF1A3C",
                      border: "1px solid rgba(255,26,60,0.3)",
                      fontFamily: "'Orbitron', sans-serif",
                    }}
                  >
                    {user?.email?.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-col items-start min-w-0">
                  <span className="text-xs font-medium truncate w-full text-left text-gray-300"
                    style={{ fontFamily: "'Rajdhani', sans-serif" }}>
                    {user?.email}
                  </span>
                  <span className="text-[10px] text-gray-600 capitalize"
                    style={{ fontFamily: "'Rajdhani', sans-serif", color: "rgba(255,26,60,0.45)" }}>
                    {user?.role}
                  </span>
                </div>
                <ChevronRight className="h-3 w-3 text-gray-600 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="right"
              className="w-48"
              style={{
                background: "#0e0005",
                border: "1px solid rgba(255,26,60,0.25)",
                boxShadow: "0 0 20px rgba(255,26,60,0.15)",
              }}
            >
              <DropdownMenuItem asChild>
                <Link to="/settings" className="text-gray-300 focus:text-white focus:bg-[rgba(255,26,60,0.1)]">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator style={{ background: "rgba(255,26,60,0.15)" }} />
              <DropdownMenuItem
                onClick={handleLogout}
                className="focus:bg-[rgba(255,26,60,0.1)]"
                style={{ color: "#FF1A3C" }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
