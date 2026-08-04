import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SEEK_INTERVAL_STORAGE_KEY = "streamfusion-seek-intervals";
export const SEEK_INTERVAL_STORE_VERSION = 1;
export const DEFAULT_SEEK_INTERVAL_SECONDS = 10;

export interface SeekIntervalPreferences {
  rewindSeconds: number;
  forwardSeconds: number;
}

interface SeekIntervalState extends SeekIntervalPreferences {
  setRewindSeconds: (seconds: number) => void;
  setForwardSeconds: (seconds: number) => void;
}

function normalizeSeekIntervalSeconds(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_SEEK_INTERVAL_SECONDS;
}

export function migrateSeekIntervalState(persisted: unknown): SeekIntervalPreferences {
  const legacy = typeof persisted === "object" && persisted !== null ? persisted : {};

  return {
    rewindSeconds: normalizeSeekIntervalSeconds(
      "rewindSeconds" in legacy ? legacy.rewindSeconds : undefined
    ),
    forwardSeconds: normalizeSeekIntervalSeconds(
      "forwardSeconds" in legacy ? legacy.forwardSeconds : undefined
    ),
  };
}

export const useSeekIntervalStore = create<SeekIntervalState>()(
  persist(
    (set) => ({
      rewindSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
      forwardSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
      setRewindSeconds: (rewindSeconds) =>
        set({ rewindSeconds: normalizeSeekIntervalSeconds(rewindSeconds) }),
      setForwardSeconds: (forwardSeconds) =>
        set({ forwardSeconds: normalizeSeekIntervalSeconds(forwardSeconds) }),
    }),
    {
      name: SEEK_INTERVAL_STORAGE_KEY,
      version: SEEK_INTERVAL_STORE_VERSION,
      migrate: migrateSeekIntervalState,
      merge: (persisted, current) => ({
        ...current,
        ...migrateSeekIntervalState(persisted),
      }),
      partialize: ({ rewindSeconds, forwardSeconds }) => ({ rewindSeconds, forwardSeconds }),
    }
  )
);
