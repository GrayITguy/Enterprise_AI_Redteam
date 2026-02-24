import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Login from "../pages/Login";

// Mock the api module
vi.mock("../lib/api", () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

// Mock the auth store
vi.mock("../store/authStore", () => ({
  useAuthStore: vi.fn(() => ({
    setAuth: vi.fn(),
    token: null,
    user: null,
  })),
}));

// Mock react-router navigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders email and password fields", () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("renders the sign-in button", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders a link to the setup page", () => {
    renderLogin();
    expect(screen.getByRole("link", { name: /set up your account/i })).toBeInTheDocument();
  });

  it("shows 'Signing in...' while the mutation is pending", async () => {
    const { api } = await import("../lib/api");
    // Never resolves, so mutation stays pending
    vi.mocked(api.post).mockReturnValue(new Promise(() => {}));

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
    });
  });

  it("navigates to /dashboard on successful login", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        token: "fake-jwt",
        user: { id: "1", email: "test@example.com", role: "admin" },
      },
    });

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows error alert when login fails", async () => {
    const { api } = await import("../lib/api");
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { error: "Invalid email or password" } },
    });

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "wrong@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });
});
