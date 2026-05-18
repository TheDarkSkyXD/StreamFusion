/**
 * User Profile Cache Store (U16)
 *
 * Session-scoped cache for the user popout's profile fetch. Keyed by
 * `${platform}:${userId}:${channelId}` and TTL'd at 5 minutes so re-opening
 * the popout for the same user within a session avoids a second Helix /
 * Kick round-trip.
 */

import { create } from "zustand";

import type { UserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";

const TTL_MS = 5 * 60 * 1000; // 5 minutes per the plan.

interface CachedEntry {
  profile: UserProfile;
  fetchedAt: number;
}

interface UserProfileCacheState {
  entries: Record<string, CachedEntry>;
  get: (key: string) => UserProfile | null;
  set: (key: string, profile: UserProfile) => void;
  clear: () => void;
}

export const userProfileCacheKey = (
  platform: "twitch" | "kick",
  userId: string,
  channelId: string,
): string => `${platform}:${userId}:${channelId}`;

export const useUserProfileCacheStore = create<UserProfileCacheState>()((set, get) => ({
  entries: {},
  get: (key) => {
    const entry = get().entries[key];
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > TTL_MS) return null;
    return entry.profile;
  },
  set: (key, profile) => {
    set((state) => ({
      entries: { ...state.entries, [key]: { profile, fetchedAt: Date.now() } },
    }));
  },
  clear: () => set({ entries: {} }),
}));
