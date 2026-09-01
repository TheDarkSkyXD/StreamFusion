import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Platform } from "@shared/auth-types";
import type { RaidTarget } from "@shared/raid-handoff-types";

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
export type MultiChatView = "merged" | "tabs";

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

export const MULTIVIEW_PLAYBACK_BUDGET_MIN = 1;
export const DEFAULT_MULTIVIEW_PLAYBACK_BUDGET = 4;
export const DEFAULT_BACKGROUND_QUALITY: BackgroundQuality = "auto-low";

export const MULTISTREAM_STORE_VERSION = 5;

export type ReplaceRaidSourceResult =
  | { kind: "replaced"; targetStreamId: string; wasFocused: boolean }
  | {
      kind: "merged-existing";
      targetStreamId: string;
      removedSourceId: string;
      wasFocused: boolean;
    }
  | { kind: "source-not-found" };

interface MultiStreamState {
  // Streams
  streams: MultiStreamConfig[];
  addStream: (platform: Platform, channelName: string) => void;
  removeStream: (streamId: string) => void;
  updateStream: (
    streamId: string,
    updates: Partial<Pick<MultiStreamConfig, "isMuted" | "volume">>
  ) => void;
  replaceRaidSource: (streamId: string, target: RaidTarget) => ReplaceRaidSourceResult;
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
  multiChatView: MultiChatView;
  toggleChat: () => void;
  setChatStream: (streamId: string | null) => void;
  setMultiChatView: (view: MultiChatView) => void;

  // Audio
  toggleMute: (streamId: string) => void;
  setVolume: (streamId: string, volume: number) => void;

  // Performance budget, not a layout limit. The layout may contain any number
  // of streams; only this many video decoders mount concurrently.
  playbackBudget: number;
  setPlaybackBudget: (n: number) => void;

  // BackgroundQuality (slice 03): persisted default for the SlotPresence quality
  // clamp on background slots. UI to configure this ships in slice 08.
  backgroundQuality: BackgroundQuality;
  setBackgroundQuality: (q: BackgroundQuality) => void;
}

function normalizePlaybackBudget(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MULTIVIEW_PLAYBACK_BUDGET;
  return Math.max(MULTIVIEW_PLAYBACK_BUDGET_MIN, Math.round(n));
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

function normalizeChannelName(channelName: string): string {
  return channelName.trim();
}

function buildStreamId(platform: Platform, channelName: string): string {
  return `${platform}-${normalizeChannelName(channelName).toLowerCase()}`;
}

function normalizePersistedStreams(values: unknown[]): {
  streams: MultiStreamConfig[];
  idsByPersistedId: Map<string, string>;
} {
  const streams: MultiStreamConfig[] = [];
  const idsByPersistedId = new Map<string, string>();
  const seen = new Set<string>();

  for (const value of values) {
    if (!isMultiStreamConfig(value)) continue;
    const channelName = normalizeChannelName(value.channelName);
    if (!channelName) continue;
    const id = buildStreamId(value.platform, channelName);
    idsByPersistedId.set(value.id, id);
    if (seen.has(id)) continue;
    seen.add(id);
    streams.push({ ...value, id, channelName });
  }

  return { streams, idsByPersistedId };
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
  | "multiChatView"
  | "playbackBudget"
  | "backgroundQuality"
> {
  const p = isRecord(persisted) ? persisted : {};

  const { streams, idsByPersistedId } = normalizePersistedStreams(
    Array.isArray(p.streams) ? p.streams : []
  );
  const favoriteStreams = Array.isArray(p.favoriteStreams)
    ? p.favoriteStreams.filter(isFavoriteStreamRef)
    : [];
  const layout: LayoutMode = p.layout === "focus" ? "focus" : "grid";
  const isChatOpen = typeof p.isChatOpen === "boolean" ? p.isChatOpen : true;
  const chatStreamId =
    (typeof p.chatStreamId === "string" ? idsByPersistedId.get(p.chatStreamId) : undefined) ??
    streams[0]?.id ??
    null;
  const multiChatView: MultiChatView = p.multiChatView === "tabs" ? "tabs" : "merged";

  const rawPlaybackBudget = p.playbackBudget ?? p.multiviewCap;
  const playbackBudget =
    typeof rawPlaybackBudget === "number"
      ? normalizePlaybackBudget(rawPlaybackBudget)
      : DEFAULT_MULTIVIEW_PLAYBACK_BUDGET;

  const backgroundQuality = isBackgroundQuality(p.backgroundQuality)
    ? p.backgroundQuality
    : DEFAULT_BACKGROUND_QUALITY;

  return {
    streams,
    favoriteStreams,
    layout,
    isChatOpen,
    chatStreamId,
    multiChatView,
    playbackBudget,
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
      multiChatView: "merged",
      playbackBudget: DEFAULT_MULTIVIEW_PLAYBACK_BUDGET,
      backgroundQuality: DEFAULT_BACKGROUND_QUALITY,

      addStream: (platform, channelName) =>
        set((state) => {
          const normalizedChannelName = normalizeChannelName(channelName);
          if (!normalizedChannelName) return state;
          const id = buildStreamId(platform, normalizedChannelName);
          if (state.streams.some((s) => s.id === id)) return state; // No duplicates

          const newStream: MultiStreamConfig = {
            id,
            platform,
            channelName: normalizedChannelName,
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

      replaceRaidSource: (streamId, target) => {
        let result: ReplaceRaidSourceResult = { kind: "source-not-found" };
        set((state) => {
          const sourceIndex = state.streams.findIndex((stream) => stream.id === streamId);
          const source = state.streams[sourceIndex];
          if (!source || source.platform !== target.platform) return state;

          const targetStreamId = buildStreamId(target.platform, target.channelSlug);
          const wasFocused = state.focusedStreamId === streamId;
          const existingTarget = state.streams.find(
            (stream) => stream.id === targetStreamId && stream.id !== streamId
          );

          if (existingTarget) {
            result = {
              kind: "merged-existing",
              targetStreamId: existingTarget.id,
              removedSourceId: streamId,
              wasFocused,
            };
            return {
              streams: state.streams.filter((stream) => stream.id !== streamId),
              focusedStreamId: wasFocused ? existingTarget.id : state.focusedStreamId,
              chatStreamId:
                state.chatStreamId === streamId ? existingTarget.id : state.chatStreamId,
            };
          }

          const replacement: MultiStreamConfig = {
            ...source,
            id: targetStreamId,
            channelName: target.channelSlug,
          };
          const streams = [...state.streams];
          streams[sourceIndex] = replacement;
          result = { kind: "replaced", targetStreamId, wasFocused };
          return {
            streams,
            focusedStreamId: wasFocused ? targetStreamId : state.focusedStreamId,
            chatStreamId: state.chatStreamId === streamId ? targetStreamId : state.chatStreamId,
          };
        });
        return result;
      },

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
      setMultiChatView: (multiChatView) =>
        set((state) => ({
          multiChatView,
          chatStreamId:
            multiChatView === "tabs" && !state.streams.some(({ id }) => id === state.chatStreamId)
              ? (state.streams[0]?.id ?? null)
              : state.chatStreamId,
        })),

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

      // The budget limits concurrent decoders, never the number of saved layout slots.
      setPlaybackBudget: (n) => set({ playbackBudget: normalizePlaybackBudget(n) }),

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
        chatStreamId: state.chatStreamId,
        multiChatView: state.multiChatView,
        playbackBudget: state.playbackBudget,
        backgroundQuality: state.backgroundQuality,
      }),
    }
  )
);
