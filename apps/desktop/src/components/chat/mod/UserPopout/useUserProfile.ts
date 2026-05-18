/**
 * useUserProfile (U16)
 *
 * Fetches profile data for the user popout — display name, avatar,
 * account-creation date, follow-since, badges, subscription info. Twitch
 * uses three Helix endpoints (`/users`, `/channels/followed`,
 * `/subscriptions/user`); Kick uses the v2 channel-users endpoint with a
 * graceful fallback. Auxiliary fetches that 401 are treated as
 * "not following / not subscribed" so the popout always opens.
 *
 * Results are session-cached at 5-minute TTL via
 * `useUserProfileCacheStore`. Cache hits skip the network entirely.
 */

import { useEffect, useRef, useState } from "react";

import {
  userProfileCacheKey,
  useUserProfileCacheStore,
} from "@/store/user-profile-cache-store";

export interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  /** ISO timestamp — when the platform account was created. */
  createdAt: string;
  /** ISO timestamp — when the viewer started following this channel. */
  followSince: string | null;
  subscription: {
    tier: "1000" | "2000" | "3000" | null;
    months: number | null;
    isGift: boolean;
  } | null;
  isFounder: boolean;
  isVip: boolean;
  isMod: boolean;
  // Kick-only:
  bio?: string;
  verified?: boolean;
}

const HELIX_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const HELIX_BASE = "https://api.twitch.tv/helix";

interface HelixUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
  created_at: string;
}

interface HelixFollow {
  broadcaster_id: string;
  followed_at: string;
}

interface HelixSubscription {
  tier: string;
  is_gift: boolean;
}

async function fetchTwitchProfile(
  userId: string,
  channelId: string,
  accessToken: string | null,
): Promise<UserProfile | null> {
  const headers: Record<string, string> = {
    "Client-Id": HELIX_CLIENT_ID,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const userRes = await fetch(`${HELIX_BASE}/users?id=${userId}`, { headers });
  if (!userRes.ok) return null;
  const userBody = (await userRes.json()) as { data: HelixUser[] };
  const u = userBody.data?.[0];
  if (!u) return null;

  // Aux fetches — treat 401 / failures as "no data" rather than failing.
  let followSince: string | null = null;
  let subscription: UserProfile["subscription"] = null;
  if (accessToken) {
    try {
      const followRes = await fetch(
        `${HELIX_BASE}/channels/followed?user_id=${userId}&broadcaster_id=${channelId}`,
        { headers },
      );
      if (followRes.ok) {
        const body = (await followRes.json()) as { data: HelixFollow[] };
        followSince = body.data?.[0]?.followed_at ?? null;
      }
    } catch {
      // Silent — defaults to null.
    }
    try {
      const subRes = await fetch(
        `${HELIX_BASE}/subscriptions/user?broadcaster_id=${channelId}&user_id=${userId}`,
        { headers },
      );
      if (subRes.ok) {
        const body = (await subRes.json()) as { data: HelixSubscription[] };
        const s = body.data?.[0];
        if (s) {
          subscription = {
            tier: (s.tier as "1000" | "2000" | "3000") ?? null,
            months: null,
            isGift: Boolean(s.is_gift),
          };
        }
      }
    } catch {
      // Silent — defaults to null.
    }
  }

  return {
    userId: u.id,
    username: u.login,
    displayName: u.display_name,
    avatarUrl: u.profile_image_url,
    createdAt: u.created_at,
    followSince,
    subscription,
    isFounder: false,
    isVip: false,
    isMod: false,
  };
}

interface KickUserApi {
  id: number;
  username: string;
  slug?: string;
  profile_pic?: string;
  created_at?: string;
  bio?: string;
  verified?: boolean | { id: number };
}

async function fetchKickProfile(
  userId: string,
  username: string,
  channelSlug: string,
): Promise<UserProfile | null> {
  // Try the public channel-user endpoint first.
  try {
    const res = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(
        channelSlug,
      )}/users/${encodeURIComponent(username)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as KickUserApi;
      return {
        userId: String(body.id ?? userId),
        username: body.username ?? username,
        displayName: body.username ?? username,
        avatarUrl: body.profile_pic ?? "",
        createdAt: body.created_at ?? "",
        followSince: null,
        subscription: null,
        isFounder: false,
        isVip: false,
        isMod: false,
        bio: body.bio,
        verified: typeof body.verified === "boolean" ? body.verified : Boolean(body.verified),
      };
    }
  } catch {
    // Fall through.
  }
  // Minimal fallback so the popout still renders something.
  return {
    userId,
    username,
    displayName: username,
    avatarUrl: "",
    createdAt: "",
    followSince: null,
    subscription: null,
    isFounder: false,
    isVip: false,
    isMod: false,
  };
}

export interface UseUserProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
}

export function useUserProfile(
  userId: string | null,
  platform: "twitch" | "kick",
  channelId: string | null,
  username?: string,
  channelSlug?: string,
): UseUserProfileResult {
  const cacheGet = useUserProfileCacheStore((s) => s.get);
  const cacheSet = useUserProfileCacheStore((s) => s.set);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!userId || !channelId) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    const key = userProfileCacheKey(platform, userId, channelId);
    const cached = cacheGet(key);
    if (cached) {
      setProfile(cached);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setProfile(null);

    const requestId = ++requestIdRef.current;
    (async () => {
      try {
        let next: UserProfile | null = null;
        if (platform === "twitch") {
          let accessToken: string | null = null;
          try {
            const token = await window.electronAPI.auth.getToken("twitch");
            accessToken = token?.accessToken ?? null;
          } catch {
            accessToken = null;
          }
          next = await fetchTwitchProfile(userId, channelId, accessToken);
        } else {
          next = await fetchKickProfile(userId, username ?? userId, channelSlug ?? "");
        }
        if (requestId !== requestIdRef.current) return;
        if (!next) {
          setProfile(null);
          setError("not-found");
          setLoading(false);
          return;
        }
        cacheSet(key, next);
        setProfile(next);
        setLoading(false);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setProfile(null);
        setError(err instanceof Error ? err.message : "fetch-failed");
        setLoading(false);
      }
    })();
  }, [userId, platform, channelId, username, channelSlug, cacheGet, cacheSet]);

  return { profile, loading, error };
}
