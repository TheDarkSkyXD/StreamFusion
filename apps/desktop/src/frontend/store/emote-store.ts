/**
 * Emote Store
 *
 * Zustand store for managing emote state in the UI.
 * Handles emote loading, caching, and search functionality.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { logger } from "@/renderer/logging/logger";
import { emoteManager } from "../../backend/services/emotes";
import type { Emote, EmoteProvider } from "../../backend/services/emotes/emote-types";
import type { ChatDisplayPreferences } from "../../shared/auth-types";
import { Platform } from "@streamfusion/core/platform";

/**
 * Single-flight dedup for per-platform global emote fetches. Module-scoped
 * because it's a write-side gate, not state that drives UI re-renders. Mirrors
 * the EmoteManager.channelEmoteInFlight pattern so two simultaneous Twitch +
 * Kick loads (e.g. multistream) each run exactly once instead of one being
 * suppressed by the other's shared `isLoading` flag.
 */
const inFlightGlobalLoads = new Map<Platform | "legacy", Promise<void>>();
const emoteNameMapCache = new Map<
  string,
  {
    emoteRevision: number;
    map: Map<string, Emote>;
  }
>();

export interface EmoteViewerScope {
  platform: Platform;
  userId: string | null;
}

const PLATFORM_RECENT_PROVIDERS: Record<Platform, ReadonlySet<EmoteProvider>> = {
  twitch: new Set(["twitch", "7tv", "bttv", "ffz"]),
  kick: new Set(["kick", "7tv"]),
};

export function getEmoteViewerScopeKey(scope: EmoteViewerScope): string {
  return `${scope.platform}:${scope.userId ?? "guest"}`;
}

interface EmoteState {
  /** Whether emotes are currently loading (UI hint only; not used as a gate) */
  isLoading: boolean;
  /**
   * Per-platform load tracker — authority for "have we loaded globals for X?".
   * Lets us dedupe per-platform global fetches so opening Twitch then Kick
   * still loads each platform's providers exactly once.
   */
  loadedGlobalPlatforms: Set<Platform>;
  /** Current error message if any */
  error: string | null;
  /** Bumps whenever manager-backed emote data changes without necessarily changing Set sizes. */
  emoteRevision: number;
  /** Channels that have had their emotes loaded */
  loadedChannels: Set<string>;
  /** Recently used emotes (for quick access) */
  recentEmotes: Emote[];
  /** Recently used emotes isolated by platform and authenticated viewer. */
  recentEmotesByScope: Record<string, Emote[]>;
  /** Pre-account-scoping data, claimable once by the first authenticated viewer per platform. */
  legacyRecentEmotesByPlatform: Partial<Record<Platform, Emote[]>>;
  /** Maximum number of recent emotes to track */
  maxRecentEmotes: number;
  /** Favorite emotes */
  favoriteEmotes: Emote[];
  /** Currently active channel for emote context */
  activeChannelId: string | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /**
   * Sync the third-party emote providers (7TV/BTTV/FFZ) to the viewer's
   * chatDisplay prefs. First-party `twitch`/`kick` providers are never toggled.
   * When the enabled set actually changes, clears the loaded-tracking Sets and
   * the manager's cached emotes so the NEXT channel/global load re-fetches with
   * the new provider set (next-load semantics, R10) — already-buffered messages
   * are intentionally left untouched.
   */
  applyProviderPrefs: (
    prefs: Pick<ChatDisplayPreferences, "enable7tv" | "enableBttv" | "enableFfz">
  ) => void;
  loadGlobalEmotes: (platform?: Platform, options?: { force?: boolean }) => Promise<void>;
  loadChannelEmotes: (
    channelId: string,
    channelName?: string,
    platform?: Platform,
    kickUserId?: string,
    options?: { force?: boolean }
  ) => Promise<void>;
  unloadChannelEmotes: (channelId: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  addRecentEmote: {
    (emote: Emote): void;
    (scope: EmoteViewerScope, emote: Emote): void;
  };
  getRecentEmotes: (scope: EmoteViewerScope) => Emote[];
  claimLegacyRecentEmotes: (scope: EmoteViewerScope) => void;
  clearRecentEmotes: (scope?: EmoteViewerScope) => void;
  toggleFavorite: (emote: Emote) => void;
  isFavorite: (emoteId: string) => boolean;
  searchEmotes: (query: string, limit?: number) => Emote[];
  getEmotesByProvider: () => Map<EmoteProvider, Emote[]>;
  getEmotesByProviderForChannel: (channelId: string) => Map<EmoteProvider, Emote[]>;
  getAllEmotes: () => Emote[];
  getEmoteNameMap: (channelId?: string) => Map<string, Emote>;
}

interface PersistedEmoteState {
  recentEmotes: Emote[];
  recentEmotesByScope: Record<string, Emote[]>;
  legacyRecentEmotesByPlatform: Partial<Record<Platform, Emote[]>>;
  maxRecentEmotes: number;
  favoriteEmotes: Emote[];
}

export const useEmoteStore = create<EmoteState>()(
  persist(
    (set, get) => ({
      isLoading: false,
      loadedGlobalPlatforms: new Set(),
      error: null,
      emoteRevision: 0,
      loadedChannels: new Set(),
      recentEmotes: [],
      recentEmotesByScope: {},
      legacyRecentEmotesByPlatform: {},
      maxRecentEmotes: 20,
      favoriteEmotes: [],
      activeChannelId: null,

      setLoading: (loading) => set({ isLoading: loading }),

      setError: (error) => set({ error }),

      applyProviderPrefs: (prefs) => {
        const desired: Record<"7tv" | "bttv" | "ffz", boolean> = {
          "7tv": prefs.enable7tv,
          bttv: prefs.enableBttv,
          ffz: prefs.enableFfz,
        };

        let changed = false;
        for (const [provider, enabled] of Object.entries(desired) as Array<
          [EmoteProvider, boolean]
        >) {
          if (emoteManager.isProviderEnabled(provider) !== enabled) {
            emoteManager.setProviderEnabled(provider, enabled);
            changed = true;
          }
        }

        if (!changed) return;

        // A provider was toggled — drop everything loaded so the next channel/global
        // load re-fetches with the new provider set. clearAll() purges the manager's
        // cached emotes (disabled providers stop rendering); resetting the tracking
        // Sets re-opens the load gates in loadGlobalEmotes/loadChannelEmotes. The
        // in-flight global map is module-scoped and self-clears on settle, so no
        // separate reset is needed. We do NOT re-parse already-buffered messages —
        // next-load semantics only (R10).
        emoteManager.clearAll();
        set((state) => ({
          loadedGlobalPlatforms: new Set(),
          loadedChannels: new Set(),
          emoteRevision: state.emoteRevision + 1,
        }));
      },

      loadGlobalEmotes: async (platform, options) => {
        const state = get();
        // Per-platform gate when platform is given (so opening Twitch then Kick
        // still loads each platform's providers once). Falls back to the legacy
        // "loaded anything" gate when called without a platform.
        if (
          !options?.force &&
          (platform
            ? state.loadedGlobalPlatforms.has(platform)
            : state.loadedGlobalPlatforms.size > 0)
        )
          return;

        // Single-flight per-platform key. Critically, "twitch" and "kick" are
        // independent keys — a Kick load no longer blocks a concurrent Twitch
        // load the way the old shared `isLoading` boolean did.
        const key: Platform | "legacy" = platform ?? "legacy";
        const existing = inFlightGlobalLoads.get(key);
        if (existing) {
          await existing;
          return;
        }

        set({ isLoading: true, error: null });

        const run = (async () => {
          try {
            await emoteManager.loadGlobalEmotes(platform);
            set((s) => ({
              loadedGlobalPlatforms: platform
                ? new Set([...s.loadedGlobalPlatforms, platform])
                : s.loadedGlobalPlatforms,
              emoteRevision: s.emoteRevision + 1,
              isLoading: false,
            }));
          } catch (error) {
            logger.error("Store:Emote", "failed to load global emotes", {
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message, stack: error.stack }
                  : String(error),
            });
            set({
              error: "Failed to load global emotes",
              isLoading: false,
            });
          }
        })();

        inFlightGlobalLoads.set(key, run);
        try {
          await run;
        } finally {
          if (inFlightGlobalLoads.get(key) === run) {
            inFlightGlobalLoads.delete(key);
          }
        }
      },

      loadChannelEmotes: async (
        channelId,
        channelName,
        platform = "twitch",
        kickUserId,
        options
      ) => {
        const state = get();
        if (!options?.force && state.loadedChannels.has(channelId)) return;

        set({ isLoading: true, error: null });

        try {
          await emoteManager.loadChannelEmotes(channelId, channelName, platform, kickUserId);

          set((state) => ({
            loadedChannels: new Set([...state.loadedChannels, channelId]),
            emoteRevision: state.emoteRevision + 1,
            isLoading: false,
          }));
        } catch (error) {
          logger.error("Store:Emote", "failed to load channel emotes", {
            channelId,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
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
          return { loadedChannels: newLoadedChannels, emoteRevision: state.emoteRevision + 1 };
        });
      },

      setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

      addRecentEmote: (scopeOrEmote: EmoteViewerScope | Emote, scopedEmote?: Emote) => {
        if (scopedEmote) {
          const scope = scopeOrEmote as EmoteViewerScope;
          const scopeKey = getEmoteViewerScopeKey(scope);
          set((state) => {
            const ownsScope = Object.hasOwn(state.recentEmotesByScope, scopeKey);
            const canClaimLegacy =
              !ownsScope &&
              scope.userId !== null &&
              Object.hasOwn(state.legacyRecentEmotesByPlatform, scope.platform);
            const current = ownsScope
              ? (state.recentEmotesByScope[scopeKey] ?? [])
              : canClaimLegacy
                ? (state.legacyRecentEmotesByPlatform[scope.platform] ?? [])
                : [];
            const filtered = current.filter(
              (emote) => emote.id !== scopedEmote.id || emote.provider !== scopedEmote.provider
            );
            const remainingLegacy = { ...state.legacyRecentEmotesByPlatform };
            if (canClaimLegacy) delete remainingLegacy[scope.platform];
            return {
              recentEmotesByScope: {
                ...state.recentEmotesByScope,
                [scopeKey]: [scopedEmote, ...filtered].slice(0, state.maxRecentEmotes),
              },
              legacyRecentEmotesByPlatform: remainingLegacy,
            };
          });
          return;
        }

        const emote = scopeOrEmote as Emote;
        set((state) => {
          // Remove if already exists (to move to front)
          const filtered = state.recentEmotes.filter((e) => e.id !== emote.id);
          // Add to front
          const newRecent = [emote, ...filtered].slice(0, state.maxRecentEmotes);
          return { recentEmotes: newRecent };
        });
      },

      getRecentEmotes: (scope) => get().recentEmotesByScope[getEmoteViewerScopeKey(scope)] ?? [],

      claimLegacyRecentEmotes: (scope) => {
        if (!scope.userId) return;
        const scopeKey = getEmoteViewerScopeKey(scope);
        set((state) => {
          if (Object.hasOwn(state.recentEmotesByScope, scopeKey)) return state;
          const legacy = state.legacyRecentEmotesByPlatform[scope.platform];
          if (!legacy) return state;
          const remainingLegacy = { ...state.legacyRecentEmotesByPlatform };
          delete remainingLegacy[scope.platform];
          return {
            recentEmotesByScope: {
              ...state.recentEmotesByScope,
              [scopeKey]: legacy,
            },
            legacyRecentEmotesByPlatform: remainingLegacy,
          };
        });
      },

      clearRecentEmotes: (scope) => {
        if (!scope) {
          set({ recentEmotes: [] });
          return;
        }
        const scopeKey = getEmoteViewerScopeKey(scope);
        set((state) => {
          return {
            recentEmotesByScope: {
              ...state.recentEmotesByScope,
              [scopeKey]: [],
            },
          };
        });
      },

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

      getEmotesByProviderForChannel: (channelId) => {
        return new Map(
          [...emoteManager.getEmotesByProvider(channelId)].filter(([provider]) =>
            emoteManager.isProviderEnabled(provider)
          )
        );
      },

      getAllEmotes: () => {
        const state = get();
        return emoteManager.getAllEmotes(state.activeChannelId || undefined);
      },

      getEmoteNameMap: (channelId) => {
        const state = get();
        const resolvedChannelId = channelId ?? state.activeChannelId ?? "";
        const cached = emoteNameMapCache.get(resolvedChannelId);
        if (cached?.emoteRevision === state.emoteRevision) {
          return cached.map;
        }

        const map = new Map(
          emoteManager
            .getAllEmotes(resolvedChannelId || undefined)
            .map((emote) => [emote.name, emote])
        );
        emoteNameMapCache.set(resolvedChannelId, {
          emoteRevision: state.emoteRevision,
          map,
        });
        return map;
      },
    }),
    {
      name: "emote-storage",
      version: 1,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<PersistedEmoteState>;
        if (version >= 1 || state.recentEmotesByScope) {
          return {
            recentEmotes: state.recentEmotes ?? [],
            recentEmotesByScope: state.recentEmotesByScope ?? {},
            legacyRecentEmotesByPlatform: state.legacyRecentEmotesByPlatform ?? {},
            maxRecentEmotes: state.maxRecentEmotes ?? 20,
            favoriteEmotes: state.favoriteEmotes ?? [],
          };
        }

        const legacyRecentEmotes = Array.isArray(state.recentEmotes) ? state.recentEmotes : [];
        return {
          recentEmotes: legacyRecentEmotes,
          recentEmotesByScope: {},
          legacyRecentEmotesByPlatform: {
            twitch: legacyRecentEmotes.filter((emote) =>
              PLATFORM_RECENT_PROVIDERS.twitch.has(emote.provider)
            ),
            kick: legacyRecentEmotes.filter((emote) =>
              PLATFORM_RECENT_PROVIDERS.kick.has(emote.provider)
            ),
          },
          maxRecentEmotes: state.maxRecentEmotes ?? 20,
          favoriteEmotes: state.favoriteEmotes ?? [],
        };
      },
      partialize: (state) => ({
        recentEmotes: state.recentEmotes,
        recentEmotesByScope: state.recentEmotesByScope,
        legacyRecentEmotesByPlatform: state.legacyRecentEmotesByPlatform,
        maxRecentEmotes: state.maxRecentEmotes,
        favoriteEmotes: state.favoriteEmotes,
      }),
    }
  )
);

/**
 * Derived selector for "global emotes have loaded for at least one platform".
 * Replaces the stored `globalEmotesLoaded` boolean — `loadedGlobalPlatforms`
 * is the single authority and this hook just reads its size. Consumers that
 * need the legacy boolean shape can subscribe to this without re-rendering
 * when unrelated emote-store slices change.
 */
const useGlobalEmotesLoaded = (): boolean => useEmoteStore((s) => s.loadedGlobalPlatforms.size > 0);

export default useEmoteStore;
