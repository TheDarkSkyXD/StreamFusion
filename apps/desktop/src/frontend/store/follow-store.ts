import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";

import {
  applyAuthoritativeFollowCaches,
  invalidateFollowCachesAfterMutation,
} from "@/features/discovery/data/queries/cache-invalidation";
import { queryClient } from "@/providers/query-provider";
import { logger } from "@/renderer/logging/logger";
import type { UnifiedChannel } from "../../shared/platform-types";
import { channelsMatch } from "../lib/id-utils";
import type {
  AccountFollowWriteRequest,
  KickAccountFollowWriteSnapshot,
  FollowSource,
  KickAccountFollowWriteChangedEvent,
  LocalFollow,
  Platform,
} from "../../shared/auth-types";

// Per-channel mutation guard. Module-scoped because it's a write-side gate,
// not state that drives UI re-renders. Mirrors the auth-store pattern of
// guarding rapid duplicate clicks (`if (twitchLoading) return`) so a Follow
// click during an in-flight unfollow loop doesn't race with row deletion.
const inFlight = new Set<string>();
let subscribedFollowsApi: typeof window.electronAPI.follows | undefined;
let unsubscribeAccountWriteChanged: (() => void) | undefined;

function followKey(channel: Pick<UnifiedChannel, "platform" | "id" | "username">): string {
  // Prefer canonical id; fall back to slug so an empty-id synthesized channel
  // still gates against the canonical-id follow for the same channel.
  return `${channel.platform}:${channel.id || channel.username?.toLowerCase() || ""}`;
}

function canonicalFollowChannelId(channel: UnifiedChannel): string {
  return channel.platform === "kick" && channel.kickUserId ? channel.kickUserId : channel.id;
}

function accountFollowWriteRequest(
  channel: UnifiedChannel,
  action: "follow" | "unfollow"
): AccountFollowWriteRequest {
  const follow = {
    channelId: canonicalFollowChannelId(channel),
    channelName: channel.username,
    displayName: channel.displayName,
    profileImage: channel.avatarUrl,
  };
  return channel.platform === "kick"
    ? { action, follow: { ...follow, platform: "kick" } }
    : { action, follow: { ...follow, platform: "twitch" } };
}

function channelFromFollow(follow: LocalFollow): UnifiedChannel {
  return {
    id: follow.channelId,
    platform: follow.platform,
    username: follow.channelName,
    displayName: follow.displayName,
    avatarUrl: follow.profileImage,
    bannerUrl: "",
    bio: "",
    isLive: follow.isLive ?? false,
    isVerified: false,
    isPartner: false,
  };
}

function applyAuthoritativeAccountState(platform: Platform, activeFollows: LocalFollow[]): void {
  const authoritativeFollows = activeFollows
    .filter((follow) => follow.platform === platform)
    .map(channelFromFollow);
  useFollowStore.setState((state) => {
    const authoritativeSources = new Map(
      Array.from(state.sourceByKey).filter(([sourceKey]) => !sourceKey.startsWith(`${platform}:`))
    );
    for (const confirmedFollow of authoritativeFollows) {
      authoritativeSources.set(followKey(confirmedFollow), platform);
    }
    return {
      localFollows: [
        ...state.localFollows.filter((candidate) => candidate.platform !== platform),
        ...authoritativeFollows,
      ],
      sourceByKey: authoritativeSources,
    };
  });
  applyAuthoritativeFollowCaches(queryClient, platform, authoritativeFollows);
}

function applyTerminalAccountWrite(
  status: "auth-paused" | "failed",
  action: "follow" | "unfollow",
  targetChannel: UnifiedChannel
): void {
  const state = useFollowStore.getState();
  const hasMatchingPendingAction = state.pendingAccountActions.some(
    (pending) => pending.action === action && channelsMatch(pending.channel, targetChannel)
  );
  if (!hasMatchingPendingAction) return;

  useFollowStore.setState({
    pendingAccountActions: state.pendingAccountActions.filter(
      (pending) => pending.action !== action || !channelsMatch(pending.channel, targetChannel)
    ),
  });
  if (status === "auth-paused") {
    toast("Reconnect Kick to continue", {
      description: `Kick authentication expired before the ${action} could be confirmed. Your follow is unchanged.`,
    });
  } else {
    toast("Couldn't update follow", {
      description: `Kick couldn't confirm the ${action}. Your follow is unchanged. Try again.`,
    });
  }
}

function applyAccountWriteChanged(event: KickAccountFollowWriteChangedEvent): void {
  const targetChannel = channelFromFollow({
    id: "account-write-target",
    platform: "kick",
    channelId: event.target.channelId,
    channelName: event.target.channelName,
    displayName: event.target.channelName,
    profileImage: "",
    followedAt: "",
  });
  if (event.status === "failed" || event.status === "auth-paused") {
    applyTerminalAccountWrite(event.status, event.action, targetChannel);
    return;
  }
  if (event.status !== "confirmed") return;

  applyAuthoritativeAccountState("kick", event.activeFollows);
  useFollowStore.setState((state) => ({
    pendingAccountActions: state.pendingAccountActions.filter(
      (pending) => pending.action !== event.action || !channelsMatch(pending.channel, targetChannel)
    ),
  }));
}

function ensureAccountWriteSubscription(): void {
  const followsApi = window.electronAPI.follows;
  if (subscribedFollowsApi === followsApi) return;

  unsubscribeAccountWriteChanged?.();
  subscribedFollowsApi = followsApi;
  const cleanup = followsApi.onAccountWriteChanged?.(applyAccountWriteChanged);
  unsubscribeAccountWriteChanged = typeof cleanup === "function" ? cleanup : undefined;
}

function kickAvatarMatchesUserId(avatarUrl: string | undefined, kickUserId: string | undefined) {
  return Boolean(kickUserId && avatarUrl?.includes(`/images/user/${kickUserId}/`));
}

function sameResolvedChannel(candidate: UnifiedChannel, resolved: UnifiedChannel): boolean {
  if (candidate.platform !== resolved.platform) return false;
  const resolvedIds = new Set(
    [resolved.id, resolved.platform === "kick" ? resolved.kickUserId : undefined].filter(Boolean)
  );

  return (
    resolvedIds.has(candidate.id) ||
    (resolved.platform === "kick" &&
      kickAvatarMatchesUserId(candidate.avatarUrl, resolved.kickUserId))
  );
}

interface FollowState {
  localFollows: UnifiedChannel[];
  isHydrated: boolean;
  pendingAccountActions: Array<{
    channel: UnifiedChannel;
    action: "follow" | "unfollow";
  }>;
  /**
   * Per-channel origin lookup keyed by `${platform}:${id || username}`.
   * Populated by `hydrate` from the LocalFollow.source DB column; FollowButton
   * reads it to choose authenticated account writes for account rows and local
   * writes for guest rows. Module-scoped equivalent on the server is
   * `storageService.getActiveFollowsByPlatform`.
   */
  sourceByKey: Map<string, FollowSource>;
  followChannel: (channel: UnifiedChannel) => Promise<void>;
  followAccountChannel: (channel: UnifiedChannel) => Promise<void>;
  unfollowChannel: (channel: UnifiedChannel) => Promise<void>;
  isFollowing: (channel: UnifiedChannel) => boolean;
  /** Returns null when the channel isn't followed (anywhere). */
  getFollowSource: (channel: UnifiedChannel) => FollowSource | null;
  getPendingAccountAction: (channel: UnifiedChannel) => "follow" | "unfollow" | null;
  repairFollowMetadataFromChannel: (channel: UnifiedChannel) => Promise<boolean>;
  toggleFollow: (
    channel: UnifiedChannel,
    options?: { accountPlatform?: Platform }
  ) => Promise<void>;
  upgradeFollowIfNeeded: (channel: UnifiedChannel) => Promise<void>;
  hydrate: (options?: { waitForPendingWrites?: boolean }) => Promise<void>;
}

interface FollowCacheState {
  localFollows: UnifiedChannel[];
  sources: Array<[string, FollowSource]>;
}

export const useFollowStore = create<FollowState>()(
  persist<FollowState, [], [], FollowCacheState>(
    (set, get) => ({
      localFollows: [],
      isHydrated: false,
      pendingAccountActions: [],
      sourceByKey: new Map(),
      followChannel: async (channel) => {
        const key = followKey(channel);
        if (inFlight.has(key)) return;
        inFlight.add(key);

        try {
          const currentFollows = get().localFollows;
          const currentSources = get().sourceByKey;

          // Dedupe by platform + (id OR username) so a stale row with a different
          // numeric id (e.g. legacy Kick user_id) doesn't get duplicated by a fresh
          // follow keyed on the canonical channel.id.
          if (currentFollows.some((c) => channelsMatch(c, channel))) return;

          // Optimistic source stays "guest": it only gates local-toggle vs.
          // platform redirect in FollowButton, and we never optimistically write
          // "account". The authoritative source ("local" when signed in to this
          // platform, else "guest") is decided server-side and adopted below.
          const nextSources = new Map(currentSources);
          nextSources.set(key, "guest");
          set({ localFollows: [...currentFollows, channel], sourceByKey: nextSources });

          try {
            const added = await window.electronAPI.follows.add({
              platform: channel.platform as "twitch" | "kick",
              channelId: canonicalFollowChannelId(channel),
              channelName: channel.username,
              displayName: channel.displayName,
              profileImage: channel.avatarUrl,
            });
            // Adopt the source the backend actually assigned. Functional update so
            // we merge into the latest sourceByKey rather than clobbering entries
            // written by concurrent follow/unfollow calls while add() was in flight.
            const assignedSource = added?.source;
            if (assignedSource) {
              set((state) => {
                const merged = new Map(state.sourceByKey);
                merged.set(key, assignedSource);
                return { sourceByKey: merged };
              });
            }
            invalidateFollowCachesAfterMutation(queryClient, channel.platform);
          } catch (err) {
            logger.error("Store:Follow", "failed to save follow to backend", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            set({ localFollows: currentFollows, sourceByKey: currentSources });
            throw err;
          }
        } finally {
          inFlight.delete(key);
        }
      },
      followAccountChannel: async (channel) => {
        if (channel.platform === "kick") ensureAccountWriteSubscription();
        if (get().getPendingAccountAction(channel)) return;
        const key = followKey(channel);
        if (inFlight.has(key)) return;
        inFlight.add(key);

        const currentFollows = get().localFollows;
        const currentSources = get().sourceByKey;
        set((state) => ({
          pendingAccountActions: [...state.pendingAccountActions, { channel, action: "follow" }],
        }));

        let keepPending = false;
        try {
          const result = await window.electronAPI.follows.writeAccount(
            accountFollowWriteRequest(channel, "follow")
          );
          if (result.status === "pending") {
            keepPending = true;
            return;
          }
          if (result.status === "auth-paused" || result.status === "failed") {
            if (channel.platform === "kick") {
              applyTerminalAccountWrite(result.status, "follow", channel);
              return;
            }
            throw new Error("Twitch could not confirm the follow change. Try again.");
          }
          if (result.status === "rejected") {
            throw new Error(result.error);
          }
          if (result.status !== "confirmed") {
            throw new Error(
              `${channel.platform === "kick" ? "Kick" : "Twitch"} follow was not confirmed (${result.status}).`
            );
          }

          applyAuthoritativeAccountState(channel.platform, result.activeFollows);
        } catch (err) {
          logger.error("Store:Follow", "failed to follow account channel", {
            platform: channel.platform,
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
          await get().hydrate();
          set({ localFollows: currentFollows, sourceByKey: currentSources });
          throw err;
        } finally {
          if (!keepPending) {
            set((state) => ({
              pendingAccountActions: state.pendingAccountActions.filter(
                (pending) => !channelsMatch(pending.channel, channel)
              ),
            }));
          }
          inFlight.delete(key);
        }
      },
      unfollowChannel: async (channel) => {
        if (get().getPendingAccountAction(channel)) return;
        const key = followKey(channel);
        if (inFlight.has(key)) return;
        inFlight.add(key);

        try {
          const currentFollows = get().localFollows;
          const currentSources = get().sourceByKey;

          const followToRemove = currentFollows.find((c) => channelsMatch(c, channel));
          if (!followToRemove) {
            logger.warn("Store:Follow", "no channel found matching", {
              platform: channel.platform,
              id: channel.id,
              username: channel.username,
            });
            return;
          }

          const source =
            currentSources.get(followKey(followToRemove)) ??
            currentSources.get(
              `${followToRemove.platform}:${followToRemove.username.toLowerCase()}`
            );
          const isAccountFollow =
            (followToRemove.platform === "kick" || followToRemove.platform === "twitch") &&
            source === followToRemove.platform;

          try {
            if (isAccountFollow) {
              if (followToRemove.platform === "kick") ensureAccountWriteSubscription();
              set((state) => ({
                pendingAccountActions: [
                  ...state.pendingAccountActions,
                  { channel: followToRemove, action: "unfollow" },
                ],
              }));
              let keepPending = false;
              try {
                const result = await window.electronAPI.follows.writeAccount(
                  accountFollowWriteRequest(channel, "unfollow")
                );
                if (result.status === "pending") {
                  keepPending = true;
                  return;
                }
                if (result.status === "auth-paused" || result.status === "failed") {
                  if (followToRemove.platform === "kick") {
                    applyTerminalAccountWrite(result.status, "unfollow", followToRemove);
                    return;
                  }
                  throw new Error("Twitch could not confirm the follow change. Try again.");
                }
                if (result.status === "rejected") {
                  throw new Error(result.error);
                }
                if (result.status !== "confirmed") {
                  throw new Error(
                    `${followToRemove.platform === "kick" ? "Kick" : "Twitch"} unfollow was not confirmed (${result.status}).`
                  );
                }

                applyAuthoritativeAccountState(followToRemove.platform, result.activeFollows);
              } finally {
                if (!keepPending) {
                  set((state) => ({
                    pendingAccountActions: state.pendingAccountActions.filter(
                      (pending) => !channelsMatch(pending.channel, followToRemove)
                    ),
                  }));
                }
              }
              return;
            }

            const updatedFollows = currentFollows.filter(
              (candidate) => !channelsMatch(candidate, followToRemove)
            );
            const nextSources = new Map(currentSources);
            nextSources.delete(followKey(followToRemove));
            set({ localFollows: updatedFollows, sourceByKey: nextSources });

            const backendFollows = await window.electronAPI.follows.getAll();
            // Remove every matching row, not just the first — users who hit the
            // original cross-page bug can have two rows for the same channel
            // (legacy user_id + fresh channel.id). Removing only one leaves the
            // survivor to be re-mapped on the next hydrate().
            const slug = followToRemove.username?.toLowerCase();
            const matches = backendFollows.filter(
              (f) =>
                f.platform === followToRemove.platform &&
                (f.channelId === followToRemove.id ||
                  (!!slug && f.channelName?.toLowerCase() === slug))
            );

            for (const m of matches) {
              await window.electronAPI.follows.remove(m.id);
            }
            invalidateFollowCachesAfterMutation(queryClient, followToRemove.platform);
          } catch (err) {
            logger.error("Store:Follow", "failed to remove follow from backend", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            // Partial-failure mid-loop leaves the optimistic snapshot at odds with
            // what actually got deleted. Re-sync from DB truth rather than guessing
            // which rows still exist.
            await get().hydrate();
            if (isAccountFollow) {
              set({ localFollows: currentFollows, sourceByKey: currentSources });
            }
            throw err;
          }
        } finally {
          inFlight.delete(key);
        }
      },
      isFollowing: (channel) => {
        const follows = get().localFollows;
        return follows.some((c) => channelsMatch(c, channel));
      },
      getFollowSource: (channel) => {
        const state = get();
        const storedFollow = state.localFollows.find((candidate) =>
          channelsMatch(candidate, channel)
        );
        if (!storedFollow) return null;
        // Try the canonical key first; fall back to a slug-only lookup for the
        // synthesized-empty-id rows that can survive a hydrate cycle (see
        // `upgradeFollowIfNeeded`).
        const sources = state.sourceByKey;
        return (
          sources.get(followKey(channel)) ??
          sources.get(followKey(storedFollow)) ??
          (channel.username
            ? sources.get(`${channel.platform}:${channel.username.toLowerCase()}`)
            : undefined) ??
          "guest"
        );
      },
      getPendingAccountAction: (channel) =>
        get().pendingAccountActions.find((pending) => channelsMatch(pending.channel, channel))
          ?.action ?? null,
      repairFollowMetadataFromChannel: async (channel) => {
        if (!channel.id || !channel.username) return false;

        const currentFollows = get().localFollows;
        const existing = currentFollows.find((follow) => sameResolvedChannel(follow, channel));
        const canonicalChannelId = canonicalFollowChannelId(channel);

        if (
          !existing ||
          (existing.id === canonicalChannelId &&
            existing.username.toLowerCase() === channel.username.toLowerCase())
        ) {
          return false;
        }

        const key = followKey(channel);
        if (inFlight.has(key)) return false;
        inFlight.add(key);

        try {
          const backendFollows = await window.electronAPI.follows.getAll();
          const row = backendFollows.find(
            (follow) =>
              follow.platform === channel.platform &&
              (follow.channelId === channel.id ||
                follow.channelId === canonicalChannelId ||
                kickAvatarMatchesUserId(follow.profileImage, channel.kickUserId))
          );
          if (!row) return false;

          await window.electronAPI.follows.update(row.id, {
            channelId: canonicalChannelId,
            channelName: channel.username,
            displayName: channel.displayName,
            profileImage: channel.avatarUrl,
          });
          await get().hydrate();
          return true;
        } catch (err) {
          logger.error("Store:Follow", "failed to repair stale follow metadata", {
            channelId: channel.id,
            platform: channel.platform,
            username: channel.username,
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
          return false;
        } finally {
          inFlight.delete(key);
        }
      },
      toggleFollow: (channel, options) => {
        const { isFollowing, followAccountChannel, followChannel, unfollowChannel } = get();
        if (isFollowing(channel)) {
          return unfollowChannel(channel);
        }
        if (options?.accountPlatform === channel.platform) {
          return followAccountChannel(channel);
        }
        return followChannel(channel);
      },

      // When a canonical channel arrives for a row previously written with an
      // empty channelId (synthesized-fallback case from the VOD page — user
      // clicked Follow before useChannelByUsername resolved), upgrade the
      // in-memory row and migrate the DB row to the canonical id. Idempotent —
      // no-ops when no stale row exists.
      upgradeFollowIfNeeded: async (channel) => {
        if (!channel.id) return;
        const slug = channel.username?.toLowerCase();
        if (!slug) return;

        const currentFollows = get().localFollows;
        const stale = currentFollows.find(
          (c) => c.platform === channel.platform && !c.id && c.username?.toLowerCase() === slug
        );
        if (!stale) return;

        const key = followKey(channel);
        if (inFlight.has(key)) return;
        inFlight.add(key);

        try {
          set({
            localFollows: currentFollows.map((c) => (c === stale ? channel : c)),
          });

          try {
            const backendFollows = await window.electronAPI.follows.getAll();
            const emptyIdRows = backendFollows.filter(
              (f) =>
                f.platform === channel.platform &&
                f.channelId === "" &&
                f.channelName?.toLowerCase() === slug
            );
            for (const m of emptyIdRows) {
              await window.electronAPI.follows.remove(m.id);
            }

            const added = await window.electronAPI.follows.add({
              platform: channel.platform as "twitch" | "kick",
              channelId: channel.id,
              channelName: channel.username,
              displayName: channel.displayName,
              profileImage: channel.avatarUrl,
            });
            // Keep the source correct after the empty-id → canonical-id upgrade:
            // adopt whatever the backend assigned (functional merge, as in
            // followChannel) instead of leaving the row to fall back to "guest".
            const assignedSource = added?.source;
            if (assignedSource) {
              set((state) => {
                const merged = new Map(state.sourceByKey);
                merged.set(key, assignedSource);
                return { sourceByKey: merged };
              });
            }
            invalidateFollowCachesAfterMutation(queryClient, channel.platform);
          } catch (err) {
            logger.error("Store:Follow", "failed to upgrade follow to canonical id", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            await get().hydrate();
          }
        } finally {
          inFlight.delete(key);
        }
      },

      // Initializer to load from backend
      hydrate: async (_options = {}) => {
        try {
          ensureAccountWriteSubscription();
          const getAccountWrites = window.electronAPI.follows.getAccountWrites;
          const [follows, accountWritesResult] = await Promise.all([
            window.electronAPI.follows.getAll(),
            getAccountWrites ? getAccountWrites() : Promise.resolve([]),
          ]);
          const accountWrites: KickAccountFollowWriteSnapshot[] = Array.isArray(accountWritesResult)
            ? accountWritesResult
            : [];
          // Map LocalFollow -> UnifiedChannel, and build the source lookup in
          // the same pass so FollowButton can read it synchronously.
          const channels: UnifiedChannel[] = [];
          const sources = new Map<string, FollowSource>();
          for (const f of follows) {
            const channel: UnifiedChannel = {
              id: f.channelId,
              platform: f.platform,
              username: f.channelName,
              displayName: f.displayName,
              avatarUrl: f.profileImage,
              bannerUrl: "", // Not stored locally
              bio: "", // Not stored locally
              isLive: false, // will be updated by other hooks
              isVerified: false,
              isPartner: false,
            };
            channels.push(channel);
            sources.set(followKey(channel), f.source ?? "guest");
          }
          const pendingAccountActions: FollowState["pendingAccountActions"] = [];
          for (const write of accountWrites) {
            if (write.status === "failed" || write.status === "auth-paused") continue;
            const target: UnifiedChannel = {
              id: write.target.channelId,
              platform: "kick",
              username: write.target.channelName,
              displayName: write.target.channelName,
              avatarUrl: "",
              bannerUrl: "",
              bio: "",
              isLive: false,
              isVerified: false,
              isPartner: false,
            };
            const channel =
              channels.find((candidate) => channelsMatch(candidate, target)) ?? target;
            if (
              !pendingAccountActions.some(
                (pending) =>
                  pending.action === write.action && channelsMatch(pending.channel, channel)
              )
            ) {
              pendingAccountActions.push({ channel, action: write.action });
            }
          }
          set({ localFollows: channels, sourceByKey: sources, pendingAccountActions });
        } catch (e) {
          logger.error("Store:Follow", "failed to load local follows", {
            error:
              e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
          });
        } finally {
          set({ isHydrated: true });
        }
      },
    }),
    {
      name: "streamfusion-follow-cache",
      partialize: (state) => ({
        localFollows: state.localFollows,
        sources: Array.from(state.sourceByKey.entries()),
      }),
      merge: (persistedState, currentState) => {
        const cached = persistedState as Partial<FollowCacheState> | undefined;
        const localFollows = Array.isArray(cached?.localFollows) ? cached.localFollows : [];
        const sources = Array.isArray(cached?.sources) ? cached.sources : [];

        return {
          ...currentState,
          localFollows,
          sourceByKey: new Map(sources),
        };
      },
    }
  )
);
