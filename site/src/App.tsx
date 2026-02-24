import { Suspense, lazy } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuthStore } from "@/store/authStore";

// Lazy-loaded pages
const Login = lazy(() => import("@/pages/Login"));
const Setup = lazy(() => import("@/pages/Setup"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const ScanBuilder = lazy(() => import("@/pages/ScanBuilder"));
const ScanDetail = lazy(() => import("@/pages/ScanDetail"));
const Results = lazy(() => import("@/pages/Results"));
const Remediation = lazy(() => import("@/pages/Remediation"));
const Reports = lazy(() => import("@/pages/Reports"));
const License = lazy(() => import("@/pages/License"));
const Settings = lazy(() => import("@/pages/Settings"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />

        {/* Protected routes — wrapped in Layout */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="scans/new" element={<ScanBuilder />} />
          <Route path="scans/:id" element={<ScanDetail />} />
          <Route path="scans/:id/results" element={<Results />} />
          <Route path="scans/:id/remediate" element={<Remediation />} />
          <Route path="reports" element={<Reports />} />
          <Route path="license" element={<License />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
