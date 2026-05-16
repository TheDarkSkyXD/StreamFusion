import { create } from "zustand";

import type { UnifiedChannel } from "../backend/api/unified/platform-types";
import { channelsMatch } from "../lib/id-utils";

interface FollowState {
  localFollows: UnifiedChannel[];
  followChannel: (channel: UnifiedChannel) => void;
  unfollowChannel: (channel: UnifiedChannel) => void;
  isFollowing: (channel: UnifiedChannel) => boolean;
  toggleFollow: (channel: UnifiedChannel) => void;
  hydrate: () => Promise<void>;
}

export const useFollowStore = create<FollowState>()((set, get) => ({
  localFollows: [],
  followChannel: async (channel) => {
    const currentFollows = get().localFollows;

    // Dedupe by platform + (id OR username) so a stale row with a different
    // numeric id (e.g. legacy Kick user_id) doesn't get duplicated by a fresh
    // follow keyed on the canonical channel.id.
    if (currentFollows.some((c) => channelsMatch(c, channel))) return;

    // Optimistic update
    set({ localFollows: [...currentFollows, channel] });

    try {
      // Sync to backend
      await window.electronAPI.follows.add({
        platform: channel.platform as "twitch" | "kick",
        channelId: channel.id,
        channelName: channel.username,
        displayName: channel.displayName,
        profileImage: channel.avatarUrl,
      });
    } catch (err) {
      console.error("Failed to save follow to backend:", err);
      // Rollback on error
      set({ localFollows: currentFollows });
    }
  },
  unfollowChannel: async (channel) => {
    const currentFollows = get().localFollows;

    const followToRemove = currentFollows.find((c) => channelsMatch(c, channel));
    if (!followToRemove) {
      console.warn("[FollowStore] No channel found matching:", channel);
      return;
    }

    const updatedFollows = currentFollows.filter((c) => !channelsMatch(c, followToRemove));
    set({ localFollows: updatedFollows });

    try {
      const backendFollows = await window.electronAPI.follows.getAll();
      // Bridge by slug too — backend rows for old Kick follows carry the
      // user_id in channelId, while followToRemove.id may be the fresh
      // channel.id. The slug (channelName / username) is stable across both.
      const slug = followToRemove.username?.toLowerCase();
      const match = backendFollows.find(
        (f) =>
          f.platform === followToRemove.platform &&
          (f.channelId === followToRemove.id ||
            (!!slug && f.channelName?.toLowerCase() === slug))
      );

      if (match) {
        await window.electronAPI.follows.remove(match.id);
      }
    } catch (err) {
      console.error("Failed to remove follow from backend:", err);
      set({ localFollows: currentFollows });
    }
  },
  isFollowing: (channel) => {
    const follows = get().localFollows;
    return follows.some((c) => channelsMatch(c, channel));
  },
  toggleFollow: (channel) => {
    const { isFollowing, followChannel, unfollowChannel } = get();
    if (isFollowing(channel)) {
      unfollowChannel(channel);
    } else {
      followChannel(channel);
    }
  },

  // Initializer to load from backend
  hydrate: async () => {
    try {
      const follows = await window.electronAPI.follows.getAll();
      // Map LocalFollow -> UnifiedChannel
      const channels: UnifiedChannel[] = follows.map((f) => ({
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
      }));
      set({ localFollows: channels });
    } catch (e) {
      console.error("Failed to load local follows:", e);
    }
  },
}));
