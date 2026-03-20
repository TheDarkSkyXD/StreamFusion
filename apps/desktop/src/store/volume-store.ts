import { create } from "zustand";
import { persist } from "zustand/middleware";

interface VolumeState {
  volume: number; // 0-100
  isMuted: boolean;
  setVolume: (volume: number | ((prev: number) => number)) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
}

/**
 * Global volume store with localStorage persistence.
 * Volume persists across stream changes and app restarts.
 */
export const useVolumeStore = create<VolumeState>()(
  persist(
    (set, _get) => ({
      volume: 100,
      isMuted: false,

      setVolume: (volume) => {
        set((state) => {
          const newVolume = typeof volume === "function" ? volume(state.volume) : volume;
          const clamped = Math.max(0, Math.min(100, newVolume));
          return { volume: clamped };
        });
      },

      setMuted: (muted) => set({ isMuted: muted }),

      toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
    }),
    {
      name: "streamfusion-volume",
      version: 1,
    }
  )
);
