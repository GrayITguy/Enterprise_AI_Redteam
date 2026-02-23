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
  Shield, LayoutDashboard, FolderOpen, ScanLine,
  FileText, Key, Settings, LogOut, ChevronRight, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/scans/new", label: "New Scan", icon: ScanLine },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/license", label: "License", icon: Key },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();
  const { lastSeenAt, markSeen } = useNotificationStore();

  // Poll scans to compute the notification badge count
  const { data: scans } = useQuery({
    queryKey: ["scans"],
    queryFn: () => api.get("/scans").then((r) => r.data as any[]),
    refetchInterval: 15_000,
  });

  // Count completed scans whose completedAt is after lastSeenAt
  const newCompletedCount = (scans ?? []).filter((s: any) => {
    if (s.status !== "completed" || !s.completedAt) return false;
    const completedMs = new Date(s.completedAt).getTime();
    return completedMs > lastSeenAt;
  }).length;

  // Mark seen when user lands on dashboard
  useEffect(() => {
    if (location.pathname === "/dashboard") {
      markSeen();
    }
  }, [location.pathname, markSeen]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-4 border-b">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <div className="text-xs font-bold leading-tight text-foreground">AI Red Team</div>
            <div className="text-[10px] text-muted-foreground">Enterprise Platform</div>
          </div>
        </div>

        {/* Quick action */}
        <div className="p-2 border-b">
          <Button asChild size="sm" className="w-full gap-1.5 h-8">
            <Link to="/scans/new">
              <Zap className="h-3.5 w-3.5" />
              Quick Scan
            </Link>
          </Button>
        </div>

        {/* Nav */}
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
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {showBadge && (
                  <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {newCompletedCount > 9 ? "9+" : newCompletedCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-2 h-10"
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                    {user?.email?.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-col items-start min-w-0">
                  <span className="text-xs font-medium truncate w-full text-left text-foreground">
                    {user?.email}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize">
                    {user?.role}
                  </span>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="right" className="w-48">
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
