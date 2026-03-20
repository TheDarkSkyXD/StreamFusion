import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface HistoryItem {
  id: string; // unique key (e.g. platform-type-itemId)
  originalId: string; // original video/clip ID
  title: string;
  thumbnail: string;
  platform: "twitch" | "kick";
  type: "video" | "clip" | "stream";
  channelName: string;
  channelDisplayName?: string;
  timestamp: number;
}

interface HistoryState {
  history: HistoryItem[];

  // Add an item to history
  addToHistory: (item: Omit<HistoryItem, "timestamp">) => void;

  // Clear all history
  clearHistory: () => void;

  // Remove single item
  removeFromHistory: (id: string) => void;
}

const MAX_HISTORY_ITEMS = 200;

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, _get) => ({
      history: [],

      addToHistory: (item) => {
        set((state) => {
          // Remove existing item if present (to bump it to top)
          const validHistory = state.history.filter((i) => i.id !== item.id);

          const newItem: HistoryItem = {
            ...item,
            timestamp: Date.now(),
          };

          const newHistory = [newItem, ...validHistory];

          // Limit size
          if (newHistory.length > MAX_HISTORY_ITEMS) {
            newHistory.length = MAX_HISTORY_ITEMS;
          }

          return { history: newHistory };
        });
      },

      clearHistory: () => {
        set({ history: [] });
      },

      removeFromHistory: (id) => {
        set((state) => ({
          history: state.history.filter((item) => item.id !== id),
        }));
      },
    }),
    {
      name: "streamfusion-history-store",
      version: 1,
    }
  )
);
