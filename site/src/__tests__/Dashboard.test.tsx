import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "../pages/Dashboard";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("../store/authStore", () => ({
  useAuthStore: vi.fn(() => ({
    token: "fake-token",
    user: { id: "1", email: "admin@example.com", role: "admin" },
  })),
}));

vi.mock("../store/notificationStore", () => ({
  useNotificationStore: vi.fn(() => ({
    unreadCount: 0,
    markAllRead: vi.fn(),
  })),
}));

function renderDashboard(apiMock?: Record<string, unknown>) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (apiMock) {
      for (const [key, data] of Object.entries(apiMock)) {
        if (path.includes(key)) return Promise.resolve({ data });
      }
    }
    return Promise.resolve({ data: [] });
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Dashboard page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    renderDashboard();
    // Dashboard should render something — cards, charts, etc.
    expect(document.body).toBeTruthy();
  });

  it("renders the Projects stat card title", async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("renders the Scans stat card title", async () => {
    renderDashboard();
    await waitFor(() => {
      // Could appear in "Total Scans", "Recent Scans", or just "Scans"
      const matches = screen.queryAllByText(/scans/i);
      expect(matches.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it("shows stat cards without crashing when API returns empty data", async () => {
    renderDashboard({
      "/projects": [],
      "/scans": [],
      "/scans/stats": { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      "/scans/history": [],
      "/scans/upcoming": [],
    });
    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("renders navigation links after load", async () => {
    renderDashboard();
    await waitFor(() => {
      const links = screen.queryAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });
});
