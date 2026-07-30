import { create } from "zustand";

import type { Platform } from "@/shared/auth-types";

export type ReconnectPhase = "idle" | "submitting" | "revalidating" | "failed";

export interface ReconnectDialogPayload {
  platform?: Platform;
  missingScopes: string[];
  onReconnected?: () => void | Promise<void>;
}

interface ReconnectDialogState {
  isOpen: boolean;
  platform: Platform;
  phase: ReconnectPhase;
  missingScopes: string[];
  onReconnected: (() => void | Promise<void>) | null;
  open: (payload: ReconnectDialogPayload) => void;
  close: () => void;
  setPhase: (phase: ReconnectPhase) => void;
  fireReconnected: () => Promise<void>;
}

function isLocked(phase: ReconnectPhase): boolean {
  return phase === "submitting" || phase === "revalidating";
}

export const useReconnectDialogStore = create<ReconnectDialogState>()((set, get) => ({
  isOpen: false,
  platform: "twitch",
  phase: "idle",
  missingScopes: [],
  onReconnected: null,
  open: (payload) => {
    if (isLocked(get().phase)) return;
    set({
      isOpen: true,
      platform: payload.platform ?? "twitch",
      phase: "idle",
      missingScopes: Array.from(new Set(payload.missingScopes)),
      onReconnected: payload.onReconnected ?? null,
    });
  },
  close: () => {
    if (isLocked(get().phase)) return;
    set({ isOpen: false, phase: "idle", missingScopes: [], onReconnected: null });
  },
  setPhase: (phase) => set({ phase }),
  fireReconnected: async () => {
    const callback = get().onReconnected;
    if (!callback) return;
    await callback();
    if (get().onReconnected === callback) {
      set({ onReconnected: null });
    }
  },
}));
