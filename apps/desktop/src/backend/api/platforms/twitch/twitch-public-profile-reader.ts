import { z } from "zod";

import type {
  AccountCreatedFieldState,
  ProfileFieldState,
  TwitchPublicIdentity,
  TwitchResolvedChannel,
} from "../../../../shared/user-profile-types";
import { storageService } from "../../../services/storage-service";
import { twitchClient } from "./twitch-client";
import { helixResponseSchema } from "./twitch-helix-schemas";

const TWITCH_WEB_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const FOLLOW_SCOPE = "moderator:read:followers";
const PROFILE_TIMEOUT_MS = 8_000;

const fallbackIdentitySchema = z.object({
  data: z.object({
    user: z
      .object({
        id: z.string().min(1),
        login: z.string().min(1),
        displayName: z.string().min(1),
        profileImageURL: z.string(),
        createdAt: z.string().optional(),
      })
      .nullable(),
  }),
});

const fallbackFollowSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z.object({
    user: z.object({
      id: z.string().min(1),
      login: z.string().min(1),
      follow: z
        .object({
          followedAt: z.string(),
        })
        .nullable(),
    }),
  }),
});

function isValidTimestamp(value: string | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

async function twitchGql(body: object, accessToken?: string): Promise<unknown> {
  const response = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Client-Id": TWITCH_WEB_CLIENT_ID,
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `OAuth ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Twitch profile fallback failed: ${response.status}`);
  return response.json();
}

async function readFallbackIdentity(
  userId: string,
  username: string
): Promise<ProfileFieldState<TwitchPublicIdentity>> {
  try {
    const parsed = fallbackIdentitySchema.safeParse(
      await twitchGql({
        query:
          "query StreamFusionPublicProfile($login: String!) { user(login: $login) { id login displayName profileImageURL(width: 300) } }",
        variables: { login: username },
      })
    );
    if (!parsed.success) return { state: "failed", message: "Couldn’t verify" };
    const user = parsed.data.data.user;
    if (!user) return { state: "unavailable", message: "Unavailable" };
    if (user.id !== userId || user.login.toLowerCase() !== username.toLowerCase()) {
      return { state: "failed", message: "Couldn’t verify" };
    }
    return {
      state: "known",
      source: "first-party-fallback",
      value: {
        userId: user.id,
        username: user.login,
        displayName: user.displayName,
        avatarUrl: user.profileImageURL,
      },
    };
  } catch {
    return { state: "failed", message: "Couldn’t verify" };
  }
}

export async function getTwitchPublicIdentity(
  userId: string,
  username: string
): Promise<ProfileFieldState<TwitchPublicIdentity>> {
  if (twitchClient.isAuthenticated()) {
    try {
      const user = (await twitchClient.getUsersById([userId]))[0];
      if (user) {
        return {
          state: "known",
          source: "official",
          value: {
            userId: user.id,
            username: user.login,
            displayName: user.displayName,
            avatarUrl: user.profileImageUrl,
          },
        };
      }
    } catch {
      // Continue to the isolated public fallback.
    }
  }
  return readFallbackIdentity(userId, username);
}

export async function getTwitchAccountCreated(
  userId: string,
  username: string
): Promise<AccountCreatedFieldState> {
  if (twitchClient.isAuthenticated()) {
    try {
      const user = (await twitchClient.getUsersById([userId]))[0];
      if (
        user?.id === userId &&
        user.login.toLowerCase() === username.toLowerCase() &&
        isValidTimestamp(user.createdAt)
      ) {
        return { state: "known", source: "official", value: user.createdAt };
      }
    } catch {
      // Continue to the isolated, schema-validated first-party fallback.
    }
  }

  try {
    const parsed = fallbackIdentitySchema.safeParse(
      await twitchGql({
        query:
          "query StreamFusionAccountCreated($login: String!) { user(login: $login) { id login displayName profileImageURL(width: 50) createdAt } }",
        variables: { login: username },
      })
    );
    if (!parsed.success) return { state: "failed", message: "Couldn’t verify" };
    const user = parsed.data.data.user;
    if (
      !user ||
      user.id !== userId ||
      user.login.toLowerCase() !== username.toLowerCase() ||
      !isValidTimestamp(user.createdAt)
    ) {
      return { state: "failed", message: "Couldn’t verify" };
    }
    return {
      state: "known",
      source: "first-party-fallback",
      value: user.createdAt,
    };
  } catch {
    return { state: "failed", message: "Couldn’t verify" };
  }
}

async function readPublicFollowRelationship(
  broadcasterId: string,
  userId: string,
  username: string
): Promise<ProfileFieldState<string>> {
  try {
    const parsed = fallbackFollowSchema.safeParse(
      await twitchGql({
        query:
          "query StreamFusionUserMessageClicked($userID: ID!, $targetID: ID!) { user(id: $userID, lookupType: ALL) { id login follow(targetID: $targetID) { followedAt } } }",
        variables: { userID: userId, targetID: broadcasterId },
      })
    );
    if (!parsed.success || parsed.data.errors?.length) {
      return { state: "unavailable", message: "Unavailable" };
    }
    const user = parsed.data.data.user;
    if (user.id !== userId || user.login.toLowerCase() !== username.toLowerCase()) {
      return { state: "unavailable", message: "Unavailable" };
    }
    if (user.follow === null) {
      return { state: "negative", source: "first-party-fallback" };
    }
    if (!isValidTimestamp(user.follow.followedAt)) {
      return { state: "unavailable", message: "Unavailable" };
    }
    return {
      state: "known",
      source: "first-party-fallback",
      value: user.follow.followedAt,
    };
  } catch {
    return { state: "unavailable", message: "Unavailable" };
  }
}

export async function getTwitchFollowRelationship(
  broadcasterId: string,
  userId: string,
  username: string
): Promise<ProfileFieldState<string>> {
  const token = storageService.getToken("twitch");
  if (!token) return readPublicFollowRelationship(broadcasterId, userId, username);

  if (!token.scope?.includes(FOLLOW_SCOPE)) {
    return { state: "reconnect-required", missingScopes: [FOLLOW_SCOPE] };
  }

  try {
    const query = new URLSearchParams({
      broadcaster_id: broadcasterId,
      user_id: userId,
      first: "1",
    });
    const response = helixResponseSchema(z.object({ followed_at: z.string() })).parse(
      await twitchClient.request(`/channels/followers?${query.toString()}`)
    );
    const followedAt = response.data[0]?.followed_at;
    if (!isValidTimestamp(followedAt)) {
      return readPublicFollowRelationship(broadcasterId, userId, username);
    }
    return { state: "known", source: "official", value: followedAt };
  } catch {
    return readPublicFollowRelationship(broadcasterId, userId, username);
  }
}

export async function resolveTwitchPublicChannel(
  username: string
): Promise<ProfileFieldState<TwitchResolvedChannel>> {
  if (twitchClient.isAuthenticated()) {
    try {
      const user = (await twitchClient.getUsersByLogin([username]))[0];
      if (user) {
        return {
          state: "known",
          source: "official",
          value: { id: user.id, username: user.login, displayName: user.displayName },
        };
      }
    } catch {
      // Continue to isolated first-party fallback.
    }
  }
  try {
    const channel = await twitchClient.getChannelByLogin(username);
    return channel
      ? {
          state: "known",
          source: "first-party-fallback",
          value: {
            id: channel.id,
            username: channel.username,
            displayName: channel.displayName,
          },
        }
      : { state: "unavailable", message: "Unavailable" };
  } catch {
    return { state: "failed", message: "Unavailable" };
  }
}
