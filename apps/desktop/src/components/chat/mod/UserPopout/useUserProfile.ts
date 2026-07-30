import { useQueries } from "@tanstack/react-query";

import type {
  ProfileFieldState,
  TwitchPublicIdentity,
  TwitchResolvedChannel,
} from "@/shared/user-profile-types";

export interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  createdAt: string;
  followSince: string | null;
  subscription: {
    tier: "1000" | "2000" | "3000" | null;
    months: number | null;
    isGift: boolean;
  } | null;
  isFounder: boolean;
  isVip: boolean;
  isMod: boolean;
  bio?: string;
  verified?: boolean;
}

const PROFILE_TTL_MS = 5 * 60 * 1000;
const loadingState = { state: "loading" } as const;
const unavailableState = { state: "unavailable", message: "Unavailable" } as const;

export type RenderFieldState<T> = ProfileFieldState<T> | typeof loadingState;

export interface UseUserProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  identity: RenderFieldState<TwitchPublicIdentity>;
  accountCreated: RenderFieldState<string>;
  follow: RenderFieldState<string>;
  channel: RenderFieldState<TwitchResolvedChannel>;
  retryIdentity: () => void;
  retryAccountCreated: () => void;
  retryFollow: () => void;
  retryChannel: () => void;
}

export function useUserProfile(
  userId: string | null,
  platform: "twitch" | "kick",
  channelId: string | null,
  username?: string,
  _channelSlug?: string
): UseUserProfileResult {
  const enabled = platform === "twitch" && Boolean(userId && channelId && username);
  const [identityQuery, accountCreatedQuery, followQuery, channelQuery] = useQueries({
    queries: [
      {
        queryKey: ["userProfile", "twitch", "identity", userId, username],
        queryFn: () =>
          window.electronAPI.userProfiles.getTwitchIdentity({
            userId: userId!,
            username: username!,
          }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
      {
        queryKey: ["userProfile", "twitch", "account-created", userId, username],
        queryFn: () =>
          window.electronAPI.userProfiles.getTwitchAccountCreated({
            userId: userId!,
            username: username!,
          }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
      {
        queryKey: ["userProfile", "twitch", "follow", channelId, userId],
        queryFn: () =>
          window.electronAPI.userProfiles.getTwitchFollow({
            broadcasterId: channelId!,
            userId: userId!,
            username: username!,
          }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
      {
        queryKey: ["userProfile", "twitch", "channel", username],
        queryFn: () =>
          window.electronAPI.userProfiles.resolveTwitchChannel({ username: username! }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
    ],
  });

  const identity: RenderFieldState<TwitchPublicIdentity> =
    platform === "kick"
      ? unavailableState
      : (identityQuery.data ??
        (identityQuery.error ? { state: "failed", message: "Couldn’t verify" } : loadingState));
  const follow: RenderFieldState<string> =
    platform === "kick"
      ? unavailableState
      : (followQuery.data ??
        (followQuery.error ? { state: "failed", message: "Unavailable" } : loadingState));
  const channel: RenderFieldState<TwitchResolvedChannel> =
    platform === "kick"
      ? unavailableState
      : (channelQuery.data ??
        (channelQuery.error ? { state: "failed", message: "Unavailable" } : loadingState));
  const accountCreated: RenderFieldState<string> =
    platform === "kick"
      ? unavailableState
      : (accountCreatedQuery.data ??
        (accountCreatedQuery.error
          ? { state: "failed", message: "Couldn’t verify" }
          : loadingState));

  const knownIdentity = identity.state === "known" ? identity.value : null;
  const profile = knownIdentity
    ? {
        userId: knownIdentity.userId,
        username: knownIdentity.username,
        displayName: knownIdentity.displayName,
        avatarUrl: knownIdentity.avatarUrl,
        createdAt: accountCreated.state === "known" ? accountCreated.value : "",
        followSince: follow.state === "known" ? follow.value : null,
        subscription: null,
        isFounder: false,
        isVip: false,
        isMod: false,
      }
    : null;

  return {
    profile,
    loading: enabled && identity.state === "loading",
    error: identity.state === "failed" ? identity.message : null,
    identity,
    accountCreated,
    follow,
    channel,
    retryIdentity: () => {
      if (platform === "twitch") void identityQuery.refetch();
    },
    retryAccountCreated: () => {
      if (platform === "twitch") void accountCreatedQuery.refetch();
    },
    retryFollow: () => {
      if (platform === "twitch") void followQuery.refetch();
    },
    retryChannel: () => {
      if (platform === "twitch") void channelQuery.refetch();
    },
  };
}
