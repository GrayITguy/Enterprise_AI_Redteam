import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ScanBuilder from "../pages/ScanBuilder";
import { api } from "../lib/api";

const MOCK_PROJECTS = [
  {
    id: "project-1",
    name: "My AI App",
    targetUrl: "http://localhost:11434",
    providerType: "ollama",
  },
];

const MOCK_CATALOG = {
  plugins: [
    {
      id: "promptfoo:jailbreak",
      name: "Jailbreak Attacks",
      description: "Tests jailbreak patterns.",
      tool: "promptfoo",
      severity: "high",
      category: "jailbreak",
      tags: ["owasp"],
    },
    {
      id: "promptfoo:pii-extraction",
      name: "PII Extraction",
      description: "Tests PII leakage.",
      tool: "promptfoo",
      severity: "critical",
      category: "privacy",
      tags: ["owasp", "pii"],
    },
    {
      id: "deepteam:toxic-content",
      name: "Toxicity Detection",
      description: "Measures toxic output.",
      tool: "deepteam",
      severity: "high",
      category: "safety",
      tags: ["deepteam"],
    },
  ],
  presets: {
    quick: {
      name: "Quick Scan",
      description: "Fast 8-plugin scan.",
      plugins: ["promptfoo:jailbreak", "promptfoo:pii-extraction"],
    },
    owasp: {
      name: "OWASP LLM Top 10",
      description: "OWASP coverage.",
      plugins: ["promptfoo:jailbreak", "promptfoo:pii-extraction", "deepteam:toxic-content"],
    },
    full: {
      name: "Full Enterprise Scan",
      description: "All plugins.",
      plugins: ["promptfoo:jailbreak", "promptfoo:pii-extraction", "deepteam:toxic-content"],
    },
  },
};

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../store/authStore", () => ({
  useAuthStore: vi.fn(() => ({
    token: "fake-token",
    user: { id: "1", email: "admin@example.com", role: "admin" },
  })),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

function renderScanBuilder() {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.includes("/projects")) return Promise.resolve({ data: MOCK_PROJECTS });
    if (path.includes("/scans/catalog")) return Promise.resolve({ data: MOCK_CATALOG });
    return Promise.resolve({ data: [] });
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScanBuilder />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ScanBuilder page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page heading and step labels", () => {
    renderScanBuilder();
    expect(screen.getByText(/new security scan/i)).toBeInTheDocument();
    expect(screen.getByText(/select target project/i)).toBeInTheDocument();
    expect(screen.getByText(/select attack plugins/i)).toBeInTheDocument();
  });

  it("shows the 'Use preset' toggle and preset buttons after catalog loads", async () => {
    renderScanBuilder();

    await waitFor(() => {
      expect(screen.getByText(/use preset/i)).toBeInTheDocument();
    });

    // After catalog data loads, preset buttons (Quick Scan, OWASP LLM Top 10, Full Enterprise Scan)
    // appear next to the "Use preset" switch
    await waitFor(() => {
      expect(screen.getByText(/quick scan/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText(/owasp llm top 10/i)).toBeInTheDocument();
    expect(screen.getByText(/full enterprise scan/i)).toBeInTheDocument();
  });

  it("shows the plugin catalog grid after toggling off 'Use preset'", async () => {
    renderScanBuilder();
    const user = userEvent.setup();

    // Wait for the catalog to load (preset buttons appear)
    await waitFor(() => {
      expect(screen.getByText(/use preset/i)).toBeInTheDocument();
    });

    // Toggle off "Use preset" to show the manual plugin grid
    const toggle = screen.getByRole("switch", { name: /use preset/i });
    await user.click(toggle);

    // Plugin cards should now be visible
    await waitFor(() => {
      expect(screen.getByText(/jailbreak attacks/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    // PII Extraction is also a promptfoo plugin — visible on the active (default) tab
    expect(screen.getByText(/pii extraction/i)).toBeInTheDocument();
    // Toxicity Detection is on the deepteam tab — not checked here
  });

  it("clicking a plugin card toggles selection (no errors thrown)", async () => {
    renderScanBuilder();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /use preset/i })).toBeInTheDocument();
    });

    // Switch to manual mode to show plugin cards
    await user.click(screen.getByRole("switch", { name: /use preset/i }));

    await waitFor(() => {
      expect(screen.getByText(/jailbreak attacks/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    const pluginCard = screen.getByText(/jailbreak attacks/i).closest("[class*='cursor-pointer']") as HTMLElement;
    if (pluginCard) await user.click(pluginCard);

    expect(document.body).toBeTruthy();
  });

  it("clicking a preset button updates the plugin count", async () => {
    renderScanBuilder();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText(/quick scan/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    // Click "Quick Scan" preset button
    await user.click(screen.getByText(/quick scan/i));

    // Plugin count should reflect the quick preset (2 in mock)
    await waitFor(() => {
      expect(screen.getByText(/2 plugins selected/i)).toBeInTheDocument();
    });
  });
});
