import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Platform } from "@shared/auth-types";

export interface MultiStreamConfig {
  id: string;
  platform: Platform;
  channelName: string;
  isMuted: boolean;
  volume: number;
}

export interface FavoriteStreamRef {
  platform: Platform;
  channelId: string;
  channelName: string;
  displayName: string;
  avatarUrl?: string;
}

export type LayoutMode = "grid" | "focus";

/**
 * BackgroundQuality controls how non-focused StreamSlots render in multiview.
 * Persisted now (slice 03) so the slice 08 UI has a value to read against the
 * same versioned migration. Behavior is wired in later slices (07 + 08).
 *
 * - `auto-low`: clamp background slots to <= 480p (the default, RAM-friendly).
 * - `match-source`: background slots render at the same quality as the focused slot.
 * - `off`: background slots are audio-only / no video render.
 */
export type BackgroundQuality = "auto-low" | "match-source" | "off";

export const MULTIVIEW_CAP_MIN = 1;
export const MULTIVIEW_CAP_MAX = 6;
export const DEFAULT_MULTIVIEW_CAP = 4;
export const DEFAULT_BACKGROUND_QUALITY: BackgroundQuality = "auto-low";

/**
 * Persisted schema version for the multistream-store. Version 1 introduced
 * `MultiviewCap` + `BackgroundQuality`; version 2 adds MultiView favorites.
 * Migrations preserve prior user preferences.
 */
export const MULTISTREAM_STORE_VERSION = 2;

interface MultiStreamState {
  // Streams
  streams: MultiStreamConfig[];
  addStream: (platform: Platform, channelName: string) => void;
  removeStream: (streamId: string) => void;
  updateStream: (streamId: string, updates: Partial<MultiStreamConfig>) => void;
  reorderStreams: (startIndex: number, endIndex: number) => void;
  clearStreams: () => void;

  // MultiView-only favorites
  favoriteStreams: FavoriteStreamRef[];
  toggleFavorite: (favorite: FavoriteStreamRef) => void;
  isFavorite: (favorite: FavoriteStreamRef) => boolean;

  // Layout
  layout: LayoutMode;
  focusedStreamId: string | null;
  setLayout: (layout: LayoutMode) => void;
  setFocusedStream: (streamId: string | null) => void;

  // Chat
  isChatOpen: boolean;
  chatStreamId: string | null;
  toggleChat: () => void;
  setChatStream: (streamId: string | null) => void;

  // Audio
  toggleMute: (streamId: string) => void;
  setVolume: (streamId: string, volume: number) => void;

  // MultiviewCap (slice 03): user-configurable upper bound on simultaneous
  // StreamSlots. Range MULTIVIEW_CAP_MIN..MULTIVIEW_CAP_MAX, default 4.
  multiviewCap: number;
  setMultiviewCap: (n: number) => void;

  // BackgroundQuality (slice 03): persisted default for the SlotPresence quality
  // clamp on background slots. UI to configure this ships in slice 08.
  backgroundQuality: BackgroundQuality;
  setBackgroundQuality: (q: BackgroundQuality) => void;
}

/** Clamp a number into the MultiviewCap range. */
function clampMultiviewCap(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MULTIVIEW_CAP;
  const rounded = Math.round(n);
  return Math.max(MULTIVIEW_CAP_MIN, Math.min(MULTIVIEW_CAP_MAX, rounded));
}

const VALID_BACKGROUND_QUALITIES: ReadonlySet<BackgroundQuality> = new Set([
  "auto-low",
  "match-source",
  "off",
]);

function isBackgroundQuality(v: unknown): v is BackgroundQuality {
  return v === "auto-low" || v === "match-source" || v === "off";
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMultiStreamConfig(value: unknown): value is MultiStreamConfig {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isPlatform(value.platform) &&
    typeof value.channelName === "string" &&
    typeof value.isMuted === "boolean" &&
    typeof value.volume === "number" &&
    Number.isFinite(value.volume)
  );
}

function isFavoriteStreamRef(value: unknown): value is FavoriteStreamRef {
  return (
    isRecord(value) &&
    isPlatform(value.platform) &&
    typeof value.channelId === "string" &&
    typeof value.channelName === "string" &&
    typeof value.displayName === "string" &&
    (value.avatarUrl === undefined || typeof value.avatarUrl === "string")
  );
}

function favoriteStreamsMatch(left: FavoriteStreamRef, right: FavoriteStreamRef): boolean {
  if (left.platform !== right.platform) return false;

  const leftChannelId = left.channelId.trim();
  const rightChannelId = right.channelId.trim();
  if (leftChannelId && rightChannelId) return leftChannelId === rightChannelId;

  const leftChannelName = left.channelName.trim().toLowerCase();
  const rightChannelName = right.channelName.trim().toLowerCase();
  return Boolean(leftChannelName && rightChannelName && leftChannelName === rightChannelName);
}

/**
 * Migrate a persisted multistream-store payload to the current schema.
 * Pure function; exported so the persist middleware AND the migration test
 * call it through the same seam.
 *
 * v0 -> v1: introduce MultiviewCap (default 4) and BackgroundQuality
 * ('auto-low'). All other prior preferences are preserved as-is. Out-of-range
 * values found in a partially-corrupt payload are clamped, not discarded.
 * v1 -> v2: introduce persistent MultiView favorites (default empty).
 */
export function migrateMultiStreamState(
  persisted: unknown,
  _version: number
): Pick<
  MultiStreamState,
  | "streams"
  | "favoriteStreams"
  | "layout"
  | "isChatOpen"
  | "chatStreamId"
  | "multiviewCap"
  | "backgroundQuality"
> {
  const p = isRecord(persisted) ? persisted : {};

  const streams = Array.isArray(p.streams) ? p.streams.filter(isMultiStreamConfig) : [];
  const favoriteStreams = Array.isArray(p.favoriteStreams)
    ? p.favoriteStreams.filter(isFavoriteStreamRef)
    : [];
  const layout: LayoutMode = p.layout === "focus" ? "focus" : "grid";
  const isChatOpen = typeof p.isChatOpen === "boolean" ? p.isChatOpen : true;
  const chatStreamId = typeof p.chatStreamId === "string" ? p.chatStreamId : null;

  const rawCap = p.multiviewCap;
  const multiviewCap =
    typeof rawCap === "number" ? clampMultiviewCap(rawCap) : DEFAULT_MULTIVIEW_CAP;

  const backgroundQuality = isBackgroundQuality(p.backgroundQuality)
    ? p.backgroundQuality
    : DEFAULT_BACKGROUND_QUALITY;

  return {
    streams,
    favoriteStreams,
    layout,
    isChatOpen,
    chatStreamId,
    multiviewCap,
    backgroundQuality,
  };
}

export const useMultiStreamStore = create<MultiStreamState>()(
  persist(
    (set, get) => ({
      streams: [],
      favoriteStreams: [],
      layout: "grid",
      focusedStreamId: null,
      isChatOpen: true,
      chatStreamId: null,
      multiviewCap: DEFAULT_MULTIVIEW_CAP,
      backgroundQuality: DEFAULT_BACKGROUND_QUALITY,

      addStream: (platform, channelName) =>
        set((state) => {
          // Cap is the user-configurable MultiviewCap, not a hard-coded 6.
          // Reaching the cap is a hard stop — we do NOT silently truncate or
          // evict an existing slot to make room.
          if (state.streams.length >= state.multiviewCap) return state;
          const id = `${platform}-${channelName}`;
          if (state.streams.some((s) => s.id === id)) return state; // No duplicates

          const newStream: MultiStreamConfig = {
            id,
            platform,
            channelName,
            isMuted: state.streams.length > 0, // Auto-mute subsequent streams
            volume: 0.5,
          };

          return {
            streams: [...state.streams, newStream],
            chatStreamId: state.chatStreamId || id, // Set chat if none selected
          };
        }),

      removeStream: (streamId) =>
        set((state) => {
          const newStreams = state.streams.filter((s) => s.id !== streamId);
          return {
            streams: newStreams,
            // specialized logic to update focused stream and chat stream if removed
            focusedStreamId: state.focusedStreamId === streamId ? null : state.focusedStreamId,
            chatStreamId:
              state.chatStreamId === streamId
                ? newStreams.length > 0
                  ? newStreams[0].id
                  : null
                : state.chatStreamId,
          };
        }),

      updateStream: (streamId, updates) =>
        set((state) => ({
          streams: state.streams.map((s) => (s.id === streamId ? { ...s, ...updates } : s)),
        })),

      reorderStreams: (startIndex, endIndex) =>
        set((state) => {
          const result = Array.from(state.streams);
          const [removed] = result.splice(startIndex, 1);
          result.splice(endIndex, 0, removed);
          return { streams: result };
        }),

      clearStreams: () => set({ streams: [], chatStreamId: null, focusedStreamId: null }),

      toggleFavorite: (favorite) =>
        set((state) => ({
          favoriteStreams: state.favoriteStreams.some((candidate) =>
            favoriteStreamsMatch(candidate, favorite)
          )
            ? state.favoriteStreams.filter(
                (candidate) => !favoriteStreamsMatch(candidate, favorite)
              )
            : [...state.favoriteStreams, favorite],
        })),
      isFavorite: (favorite) =>
        get().favoriteStreams.some((candidate) => favoriteStreamsMatch(candidate, favorite)),

      setLayout: (layout) => set({ layout }),
      setFocusedStream: (focusedStreamId) =>
        set({ focusedStreamId, layout: focusedStreamId ? "focus" : "grid" }),

      toggleChat: () => set((state) => ({ isChatOpen: !state.isChatOpen })),
      setChatStream: (chatStreamId) => set({ chatStreamId }),

      toggleMute: (streamId) =>
        set((state) => ({
          streams: state.streams.map((s) =>
            s.id === streamId ? { ...s, isMuted: !s.isMuted } : s
          ),
        })),

      setVolume: (streamId, volume) =>
        set((state) => ({
          streams: state.streams.map((s) => (s.id === streamId ? { ...s, volume } : s)),
        })),

      // Clamp to the supported range. Caps below the current slot count are
      // accepted: existing slots are not retroactively evicted; future
      // addStream calls are blocked until the count is back under the cap.
      setMultiviewCap: (n) => set({ multiviewCap: clampMultiviewCap(n) }),

      setBackgroundQuality: (q) => set({ backgroundQuality: q }),
    }),
    {
      name: "multistream-storage",
      version: MULTISTREAM_STORE_VERSION,
      migrate: (persisted, version) => migrateMultiStreamState(persisted, version),
      partialize: (state) => ({
        streams: state.streams,
        favoriteStreams: state.favoriteStreams,
        layout: "grid",
        isChatOpen: state.isChatOpen,
        multiviewCap: state.multiviewCap,
        backgroundQuality: state.backgroundQuality,
      }),
    }
  )
);
