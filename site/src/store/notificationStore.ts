import { create } from "zustand";

interface NotificationState {
  lastSeenAt: number; // Unix ms timestamp
  markSeen: () => void;
}

const STORAGE_KEY = "eart_notif_seen";

const stored = localStorage.getItem(STORAGE_KEY);
const initialTs = stored ? parseInt(stored, 10) : 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  lastSeenAt: initialTs,
  markSeen: () => {
    const now = Date.now();
    localStorage.setItem(STORAGE_KEY, String(now));
    set({ lastSeenAt: now });
  },
}));
