import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Ad-blocking settings state for Twitch streams
 */
interface AdBlockState {
  /** Whether Twitch ad-blocking is enabled */
  enableAdBlock: boolean;
  /** Set ad-block enabled state */
  setEnableAdBlock: (enabled: boolean) => void;
  /** Toggle ad-block on/off */
  toggleAdBlock: () => void;
}

export const useAdBlockStore = create<AdBlockState>()(
  persist(
    (set) => ({
      enableAdBlock: true, // Enabled by default
      setEnableAdBlock: (enabled) => set({ enableAdBlock: enabled }),
      toggleAdBlock: () => set((state) => ({ enableAdBlock: !state.enableAdBlock })),
    }),
    {
      name: "streamfusion-adblock",
    }
  )
);
