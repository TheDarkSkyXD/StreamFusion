import { kickTransport } from "@backend/api/platforms/kick/kick-transport";
import { getChannelsBySlugs } from "@backend/features/discovery/adapters/kick/channel-endpoints";
import { getOAuthConfig } from "@backend/features/authentication/adapters/oauth/oauth-config";
import {
  type TokenStatusReport,
  tokenExchangeService,
} from "@backend/features/authentication/adapters/oauth/token-exchange";
import { authenticationRepository } from "@backend/features/authentication/data/authentication-repository";
import { getKickChannelViewerRole } from "@backend/features/chat/adapters/kick/kick-send-window";
import { type AuthToken, KICK_APP_SCOPES, TWITCH_APP_SCOPES } from "@shared/auth-types";
import { Platform } from "@streamfusion/core/platform";
import { getModeratedChannelsResult } from "../twitch/twitch-helix-moderation";

export type ModerationHistoryAuthorization =
  | { state: "authorized"; role: "broadcaster" | "moderator" }
  | {
      state: "denied";
      reason: "guest" | "viewer" | "missing-scopes" | "unverified";
    };

export interface ModerationHistoryAuthorizationInput {
  platform: Platform;
  channelId: string;
  channelSlug: string;
}

function hasEveryScope(
  granted: readonly string[] | undefined,
  required: readonly string[]
): boolean {
  const scopeSet = new Set(granted ?? []);
  return required.every((scope) => scopeSet.has(scope));
}

async function validateLiveCredential(
  platform: Platform,
  token: AuthToken,
  expectedUserId: string
): Promise<TokenStatusReport | null> {
  try {
    const status = await tokenExchangeService.getTokenStatus(platform, token);
    if (!status.valid || !status.userId || status.userId !== expectedUserId) return null;
    if (typeof status.expiresAt === "number" && status.expiresAt <= Date.now()) return null;
    return status;
  } catch {
    return null;
  }
}

async function authorizeTwitch(
  input: ModerationHistoryAuthorizationInput
): Promise<ModerationHistoryAuthorization> {
  const token = authenticationRepository.getToken("twitch");
  const user = authenticationRepository.getTwitchUser();
  if (!token || !user) return { state: "denied", reason: "guest" };
  const liveCredential = await validateLiveCredential("twitch", token, user.id);
  if (!liveCredential) return { state: "denied", reason: "unverified" };
  if (!hasEveryScope(liveCredential.scopes, TWITCH_APP_SCOPES)) {
    return { state: "denied", reason: "missing-scopes" };
  }
  if (user.id === input.channelId) {
    return { state: "authorized", role: "broadcaster" };
  }

  const clientId = getOAuthConfig("twitch").clientId;
  if (!clientId) return { state: "denied", reason: "unverified" };

  try {
    const result = await getModeratedChannelsResult(user.id, token.accessToken, clientId);
    if (result.state !== "complete") {
      return { state: "denied", reason: "unverified" };
    }
    return result.channels.some((channel) => channel.broadcaster_id === input.channelId)
      ? { state: "authorized", role: "moderator" }
      : { state: "denied", reason: "viewer" };
  } catch {
    return { state: "denied", reason: "unverified" };
  }
}

async function authorizeKick(
  input: ModerationHistoryAuthorizationInput
): Promise<ModerationHistoryAuthorization> {
  const token = authenticationRepository.getToken("kick");
  const user = authenticationRepository.getKickUser();
  if (!token || !user) return { state: "denied", reason: "guest" };
  const liveCredential = await validateLiveCredential("kick", token, String(user.id));
  if (!liveCredential) return { state: "denied", reason: "unverified" };
  if (!hasEveryScope(liveCredential.scopes, KICK_APP_SCOPES)) {
    return { state: "denied", reason: "missing-scopes" };
  }
  const normalizedSlug = input.channelSlug.trim().toLowerCase();
  const isAuthenticatedBroadcaster =
    String(user.id) === input.channelId &&
    (user.slug.toLowerCase() === normalizedSlug || user.username.toLowerCase() === normalizedSlug);
  if (isAuthenticatedBroadcaster) {
    return { state: "authorized", role: "broadcaster" };
  }
  try {
    const canonicalChannel = (await getChannelsBySlugs(kickTransport, [normalizedSlug])).find(
      (channel) => channel.username.trim().toLowerCase() === normalizedSlug
    );
    if (!canonicalChannel || canonicalChannel.id !== input.channelId) {
      return { state: "denied", reason: "unverified" };
    }
  } catch {
    return { state: "denied", reason: "unverified" };
  }
  if (
    user.slug.toLowerCase() === normalizedSlug ||
    user.username.toLowerCase() === normalizedSlug
  ) {
    return { state: "authorized", role: "broadcaster" };
  }

  try {
    const result = await getKickChannelViewerRole(input.channelSlug);
    if (!result.ok || result.isModerator === null) {
      return { state: "denied", reason: "unverified" };
    }
    return result.isModerator
      ? { state: "authorized", role: "moderator" }
      : { state: "denied", reason: "viewer" };
  } catch {
    return { state: "denied", reason: "unverified" };
  }
}

export function authorizeModerationHistory(
  input: ModerationHistoryAuthorizationInput
): Promise<ModerationHistoryAuthorization> {
  return input.platform === "twitch" ? authorizeTwitch(input) : authorizeKick(input);
}
