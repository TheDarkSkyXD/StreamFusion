import {
  type AuthToken,
  KICK_APP_SCOPES,
  type Platform,
  TWITCH_APP_SCOPES,
} from "../../shared/auth-types";
import { kickClient } from "../api/platforms/kick/kick-client";
import { getKickChannelViewerRole } from "../api/platforms/kick/kick-send-window";
import { getModeratedChannelsResult } from "../api/platforms/twitch/twitch-helix-moderation";
import { getOAuthConfig } from "../auth/oauth-config";
import { type TokenStatusReport, tokenExchangeService } from "../auth/token-exchange";
import { storageService } from "./storage-service";

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
  const token = storageService.getToken("twitch");
  const user = storageService.getTwitchUser();
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
  const token = storageService.getToken("kick");
  const user = storageService.getKickUser();
  if (!token || !user) return { state: "denied", reason: "guest" };
  const liveCredential = await validateLiveCredential("kick", token, String(user.id));
  if (!liveCredential) return { state: "denied", reason: "unverified" };
  if (!hasEveryScope(liveCredential.scopes, KICK_APP_SCOPES)) {
    return { state: "denied", reason: "missing-scopes" };
  }
  try {
    const normalizedSlug = input.channelSlug.trim().toLowerCase();
    const canonicalChannel = (await kickClient.getChannelsBySlugs([normalizedSlug])).find(
      (channel) => channel.username.trim().toLowerCase() === normalizedSlug
    );
    if (!canonicalChannel || canonicalChannel.id !== input.channelId) {
      return { state: "denied", reason: "unverified" };
    }
  } catch {
    return { state: "denied", reason: "unverified" };
  }
  if (user.slug.toLowerCase() === input.channelSlug.toLowerCase()) {
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
