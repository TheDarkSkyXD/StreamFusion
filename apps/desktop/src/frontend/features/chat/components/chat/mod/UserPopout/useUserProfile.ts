import { useQueries } from "@tanstack/react-query";

import { i18n } from "@/i18n";
import type {
  AccountCreatedFieldState,
  ProfileFieldState,
  PublicResolvedChannel,
  PublicUserIdentity,
} from "@shared/user-profile-types";

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
const unavailableState = {
  state: "unavailable",
  message: i18n.t("chatModeration.unavailable"),
} as const;
export type RenderFieldState<T> = ProfileFieldState<T> | typeof loadingState;
export type RenderAccountCreatedState = AccountCreatedFieldState | typeof loadingState;

export interface UseUserProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  identity: RenderFieldState<PublicUserIdentity>;
  accountCreated: RenderAccountCreatedState;
  follow: RenderFieldState<string>;
  channel: RenderFieldState<PublicResolvedChannel>;
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
  channelSlug?: string
): UseUserProfileResult {
  const enabled = Boolean(userId && channelId && username && (platform !== "kick" || channelSlug));
  const [identityQuery, accountCreatedQuery, followQuery, channelQuery] = useQueries({
    queries: [
      {
        queryKey: ["userProfile", platform, "identity", userId, username, channelSlug],
        queryFn: () =>
          platform === "twitch"
            ? window.electronAPI.userProfiles.getTwitchIdentity({
                userId: userId!,
                username: username!,
              })
            : window.electronAPI.userProfiles.getKickIdentity({
                userId: userId!,
                username: username!,
                channelSlug: channelSlug!,
              }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
      {
        queryKey: ["userProfile", platform, "account-created", userId, username, channelSlug],
        queryFn: () =>
          platform === "twitch"
            ? window.electronAPI.userProfiles.getTwitchAccountCreated({
                userId: userId!,
                username: username!,
              })
            : window.electronAPI.userProfiles.getKickAccountCreated({
                userId: userId!,
                username: username!,
                channelSlug: channelSlug!,
              }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
      {
        queryKey: ["userProfile", platform, "follow", channelId, userId, channelSlug],
        queryFn: () =>
          platform === "twitch"
            ? window.electronAPI.userProfiles.getTwitchFollow({
                broadcasterId: channelId!,
                userId: userId!,
                username: username!,
              })
            : window.electronAPI.userProfiles.getKickFollow({
                userId: userId!,
                username: username!,
                channelSlug: channelSlug!,
              }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
      {
        queryKey: ["userProfile", platform, "channel", username],
        queryFn: () =>
          platform === "twitch"
            ? window.electronAPI.userProfiles.resolveTwitchChannel({ username: username! })
            : window.electronAPI.userProfiles.resolveKickChannel({ username: username! }),
        enabled,
        staleTime: PROFILE_TTL_MS,
        retry: false,
      },
    ],
  });

  const identity: RenderFieldState<PublicUserIdentity> = !enabled
    ? unavailableState
    : (identityQuery.data ??
      (identityQuery.error
        ? { state: "failed", message: i18n.t("chatModeration.couldntVerify") }
        : loadingState));
  const follow: RenderFieldState<string> = !enabled
    ? unavailableState
    : (followQuery.data ??
      (followQuery.error
        ? { state: "failed", message: i18n.t("chatModeration.unavailable") }
        : loadingState));
  const channel: RenderFieldState<PublicResolvedChannel> = !enabled
    ? unavailableState
    : (channelQuery.data ??
      (channelQuery.error
        ? { state: "failed", message: i18n.t("chatModeration.unavailable") }
        : loadingState));
  const accountCreated: RenderAccountCreatedState = !enabled
    ? unavailableState
    : (accountCreatedQuery.data ??
      (accountCreatedQuery.error
        ? { state: "failed", message: i18n.t("chatModeration.couldntVerify") }
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
      void identityQuery.refetch();
    },
    retryAccountCreated: () => {
      void accountCreatedQuery.refetch();
    },
    retryFollow: () => {
      void followQuery.refetch();
    },
    retryChannel: () => {
      void channelQuery.refetch();
    },
  };
}
