/**
 * Emote Store
 *
 * Zustand store for managing emote state in the UI.
 * Handles emote loading, caching, and search functionality.
 */

import { create } from "zustand";
import { emoteManager } from "../backend/services/emotes";
import type { Emote, EmoteProvider } from "../backend/services/emotes/emote-types";

interface EmoteState {
  /** Whether emotes are currently loading */
  isLoading: boolean;
  /** Whether global emotes have been loaded (true once any platform completes) */
  globalEmotesLoaded: boolean;
  /**
   * Per-platform load tracker. Lets us dedupe per-platform global fetches so
   * opening Twitch then Kick still loads each platform's providers exactly once.
   */
  loadedGlobalPlatforms: Set<"twitch" | "kick">;
  /** Current error message if any */
  error: string | null;
  /** Channels that have had their emotes loaded */
  loadedChannels: Set<string>;
  /** Recently used emotes (for quick access) */
  recentEmotes: Emote[];
  /** Maximum number of recent emotes to track */
  maxRecentEmotes: number;
  /** Favorite emotes */
  favoriteEmotes: Emote[];
  /** Currently active channel for emote context */
  activeChannelId: string | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  loadGlobalEmotes: (platform?: "twitch" | "kick") => Promise<void>;
  loadChannelEmotes: (
    channelId: string,
    channelName?: string,
    platform?: "twitch" | "kick"
  ) => Promise<void>;
  unloadChannelEmotes: (channelId: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  addRecentEmote: (emote: Emote) => void;
  clearRecentEmotes: () => void;
  toggleFavorite: (emote: Emote) => void;
  isFavorite: (emoteId: string) => boolean;
  searchEmotes: (query: string, limit?: number) => Emote[];
  getEmotesByProvider: () => Map<EmoteProvider, Emote[]>;
  getAllEmotes: () => Emote[];
}

export const useEmoteStore = create<EmoteState>((set, get) => ({
  isLoading: false,
  globalEmotesLoaded: false,
  loadedGlobalPlatforms: new Set(),
  error: null,
  loadedChannels: new Set(),
  recentEmotes: [],
  maxRecentEmotes: 20,
  favoriteEmotes: [],
  activeChannelId: null,

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  loadGlobalEmotes: async (platform) => {
    const state = get();
    // Per-platform gate when platform is given (so opening Twitch then Kick
    // still loads each platform's providers once). Falls back to the legacy
    // "loaded anything" gate when called without a platform.
    if (platform ? state.loadedGlobalPlatforms.has(platform) : state.globalEmotesLoaded) return;
    if (state.isLoading) return;

    set({ isLoading: true, error: null });

    try {
      await emoteManager.loadGlobalEmotes(platform);
      set((s) => ({
        globalEmotesLoaded: true,
        loadedGlobalPlatforms: platform
          ? new Set([...s.loadedGlobalPlatforms, platform])
          : s.loadedGlobalPlatforms,
        isLoading: false,
      }));
    } catch (error) {
      console.error("[EmoteStore] Failed to load global emotes:", error);
      set({
        error: "Failed to load global emotes",
        isLoading: false,
      });
    }
  },

  loadChannelEmotes: async (channelId, channelName, platform = "twitch") => {
    const state = get();
    if (state.loadedChannels.has(channelId)) return;

    set({ isLoading: true, error: null });

    try {
      await emoteManager.loadChannelEmotes(channelId, channelName, platform);

      set((state) => ({
        loadedChannels: new Set([...state.loadedChannels, channelId]),
        isLoading: false,
      }));
    } catch (error) {
      console.error(`[EmoteStore] Failed to load channel emotes for ${channelId}:`, error);
      set({
        error: `Failed to load channel emotes`,
        isLoading: false,
      });
    }
  },

  unloadChannelEmotes: (channelId) => {
    emoteManager.clearChannelEmotes(channelId);

    set((state) => {
      const newLoadedChannels = new Set(state.loadedChannels);
      newLoadedChannels.delete(channelId);
      return { loadedChannels: newLoadedChannels };
    });
  },

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  addRecentEmote: (emote) => {
    set((state) => {
      // Remove if already exists (to move to front)
      const filtered = state.recentEmotes.filter((e) => e.id !== emote.id);
      // Add to front
      const newRecent = [emote, ...filtered].slice(0, state.maxRecentEmotes);
      return { recentEmotes: newRecent };
    });
  },

  clearRecentEmotes: () => set({ recentEmotes: [] }),

  toggleFavorite: (emote) => {
    set((state) => {
      const isFav = state.favoriteEmotes.some((e) => e.id === emote.id);
      if (isFav) {
        return {
          favoriteEmotes: state.favoriteEmotes.filter((e) => e.id !== emote.id),
        };
      } else {
        return { favoriteEmotes: [...state.favoriteEmotes, emote] };
      }
    });
  },

  isFavorite: (emoteId) => {
    const state = get();
    return state.favoriteEmotes.some((e) => e.id === emoteId);
  },

  searchEmotes: (query, limit = 20) => {
    const state = get();
    return emoteManager.searchEmotes(query, state.activeChannelId || undefined, limit);
  },

  getEmotesByProvider: () => {
    const state = get();
    return emoteManager.getEmotesByProvider(state.activeChannelId || undefined);
  },

  getAllEmotes: () => {
    const state = get();
    return emoteManager.getAllEmotes(state.activeChannelId || undefined);
  },
}));

export default useEmoteStore;
