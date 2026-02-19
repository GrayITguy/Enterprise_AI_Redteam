import { create } from "zustand";

interface User {
  id: string;
  email: string;
  role: "admin" | "analyst" | "viewer";
}

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

// Rehydrate from localStorage
const storedToken = localStorage.getItem("eart_token");
const storedUser = localStorage.getItem("eart_user");

export const useAuthStore = create<AuthState>((set, get) => ({
  token: storedToken,
  user: storedUser ? (JSON.parse(storedUser) as User) : null,

  setAuth: (token, user) => {
    localStorage.setItem("eart_token", token);
    localStorage.setItem("eart_user", JSON.stringify(user));
    set({ token, user });
  },

  clearAuth: () => {
    localStorage.removeItem("eart_token");
    localStorage.removeItem("eart_user");
    set({ token: null, user: null });
  },

  isAuthenticated: () => !!get().token && !!get().user,
}));
