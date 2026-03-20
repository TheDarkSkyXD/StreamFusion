import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PlaybackPosition {
  videoId: string;
  platform: "twitch" | "kick";
  position: number; // seconds
  duration: number; // total duration
  lastUpdated: number; // timestamp
  title?: string;
  thumbnail?: string;
}

interface PlaybackPositionState {
  positions: Record<string, PlaybackPosition>;

  // Save the current playback position
  savePosition: (
    platform: "twitch" | "kick",
    videoId: string,
    position: number,
    duration: number,
    title?: string,
    thumbnail?: string
  ) => void;

  // Get the saved position for a video
  getPosition: (platform: "twitch" | "kick", videoId: string) => PlaybackPosition | null;

  // Remove a saved position
  removePosition: (platform: "twitch" | "kick", videoId: string) => void;

  // Clear all positions
  clearAll: () => void;

  // Get recent videos (for "Continue Watching" section)
  getRecentVideos: (limit?: number) => PlaybackPosition[];
}

const createKey = (platform: string, videoId: string) => `${platform}-${videoId}`;

// Consider a video "finished" if they watched over 95% of it
const COMPLETION_THRESHOLD = 0.95;
// Minimum time watched before saving (don't save if they only watched 10 seconds)
const MIN_WATCH_TIME = 30;
// Max items to keep in storage
const MAX_STORED_POSITIONS = 100;

export const usePlaybackPositionStore = create<PlaybackPositionState>()(
  persist(
    (set, get) => ({
      positions: {},

      savePosition: (platform, videoId, position, duration, title, thumbnail) => {
        // Don't save if they haven't watched enough
        if (position < MIN_WATCH_TIME) return;

        // Don't save if they're near the end (finished watching)
        if (duration > 0 && position / duration > COMPLETION_THRESHOLD) {
          // Remove if it exists (they finished it)
          const key = createKey(platform, videoId);
          const { [key]: __, ...rest } = get().positions;
          set({ positions: rest });
          return;
        }

        const key = createKey(platform, videoId);
        const newPosition: PlaybackPosition = {
          videoId,
          platform,
          position,
          duration,
          lastUpdated: Date.now(),
          title,
          thumbnail,
        };

        set((state) => {
          const newPositions = { ...state.positions, [key]: newPosition };

          // Enforce max storage limit by removing oldest entries
          const entries = Object.entries(newPositions);
          if (entries.length > MAX_STORED_POSITIONS) {
            entries.sort(([, a], [, b]) => b.lastUpdated - a.lastUpdated);
            const trimmed = Object.fromEntries(entries.slice(0, MAX_STORED_POSITIONS));
            return { positions: trimmed };
          }

          return { positions: newPositions };
        });
      },

      getPosition: (platform, videoId) => {
        const key = createKey(platform, videoId);
        return get().positions[key] || null;
      },

      removePosition: (platform, videoId) => {
        const key = createKey(platform, videoId);
        set((state) => {
          const { [key]: __, ...rest } = state.positions;
          return { positions: rest };
        });
      },

      clearAll: () => {
        set({ positions: {} });
      },

      getRecentVideos: (limit = 10) => {
        const positions = Object.values(get().positions);
        return positions.sort((a, b) => b.lastUpdated - a.lastUpdated).slice(0, limit);
      },
    }),
    {
      name: "streamfusion-playback-positions",
      version: 1,
    }
  )
);
