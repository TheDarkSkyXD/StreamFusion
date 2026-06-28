import { create } from "zustand";

import { logger } from "@/renderer/logging/logger";
import type { UnifiedChannel } from "../backend/api/unified/platform-types";
import { channelsMatch } from "../lib/id-utils";
import type { FollowSource } from "../shared/auth-types";

// Per-channel mutation guard. Module-scoped because it's a write-side gate,
// not state that drives UI re-renders. Mirrors the auth-store pattern of
// guarding rapid duplicate clicks (`if (twitchLoading) return`) so a Follow
// click during an in-flight unfollow loop doesn't race with row deletion.
const inFlight = new Set<string>();

function followKey(channel: Pick<UnifiedChannel, "platform" | "id" | "username">): string {
  // Prefer canonical id; fall back to slug so an empty-id synthesized channel
  // still gates against the canonical-id follow for the same channel.
  return `${channel.platform}:${channel.id || channel.username?.toLowerCase() || ""}`;
}

function canonicalFollowChannelId(channel: UnifiedChannel): string {
  return channel.platform === "kick" && channel.kickUserId ? channel.kickUserId : channel.id;
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
  /**
   * Per-channel origin lookup keyed by `${platform}:${id || username}`.
   * Populated by `hydrate` from the LocalFollow.source DB column; FollowButton
   * reads it to decide whether to redirect to the source platform (account
   * rows) vs. toggle locally (guest rows). Module-scoped equivalent on the
   * server is `storageService.getActiveFollowsByPlatform`.
   */
  sourceByKey: Map<string, FollowSource>;
  followChannel: (channel: UnifiedChannel) => void;
  unfollowChannel: (channel: UnifiedChannel) => void;
  isFollowing: (channel: UnifiedChannel) => boolean;
  /** Returns null when the channel isn't followed (anywhere). */
  getFollowSource: (channel: UnifiedChannel) => FollowSource | null;
  repairFollowMetadataFromChannel: (channel: UnifiedChannel) => Promise<boolean>;
  toggleFollow: (channel: UnifiedChannel) => void;
  upgradeFollowIfNeeded: (channel: UnifiedChannel) => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useFollowStore = create<FollowState>()((set, get) => ({
  localFollows: [],
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
      } catch (err) {
        logger.error("Store:Follow", "failed to save follow to backend", {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
        set({ localFollows: currentFollows, sourceByKey: currentSources });
      }
    } finally {
      inFlight.delete(key);
    }
  },
  unfollowChannel: async (channel) => {
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

      const updatedFollows = currentFollows.filter((c) => !channelsMatch(c, followToRemove));
      const nextSources = new Map(currentSources);
      nextSources.delete(followKey(followToRemove));
      set({ localFollows: updatedFollows, sourceByKey: nextSources });

      try {
        const backendFollows = await window.electronAPI.follows.getAll();
        // Remove every matching row, not just the first — users who hit the
        // original cross-page bug can have two rows for the same channel
        // (legacy user_id + fresh channel.id). Removing only one leaves the
        // survivor to be re-mapped on the next hydrate().
        const slug = followToRemove.username?.toLowerCase();
        const matches = backendFollows.filter(
          (f) =>
            f.platform === followToRemove.platform &&
            (f.channelId === followToRemove.id || (!!slug && f.channelName?.toLowerCase() === slug))
        );

        for (const m of matches) {
          await window.electronAPI.follows.remove(m.id);
        }
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
    if (!get().isFollowing(channel)) return null;
    // Try the canonical key first; fall back to a slug-only lookup for the
    // synthesized-empty-id rows that can survive a hydrate cycle (see
    // `upgradeFollowIfNeeded`).
    const sources = get().sourceByKey;
    return (
      sources.get(followKey(channel)) ??
      (channel.username
        ? sources.get(`${channel.platform}:${channel.username.toLowerCase()}`)
        : undefined) ??
      "guest"
    );
  },
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
  toggleFollow: (channel) => {
    const { isFollowing, followChannel, unfollowChannel } = get();
    if (isFollowing(channel)) {
      unfollowChannel(channel);
    } else {
      followChannel(channel);
    }
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
  hydrate: async () => {
    try {
      const follows = await window.electronAPI.follows.getAll();
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
      set({ localFollows: channels, sourceByKey: sources });
    } catch (e) {
      logger.error("Store:Follow", "failed to load local follows", {
        error:
          e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
      });
    }
  },
}));
