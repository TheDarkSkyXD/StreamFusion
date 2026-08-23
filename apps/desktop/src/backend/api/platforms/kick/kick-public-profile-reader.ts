import type {
  AccountCreatedFieldState,
  KickPublicIdentity,
  KickResolvedChannel,
  ProfileFieldState,
} from "../../../../shared/user-profile-types";
import { kickClient } from "./kick-client";

const FALLBACK_COALESCE_MS = 1000;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const fallbackSnapshots = new Map<
  string,
  { expiresAt: number; promise: ReturnType<typeof kickClient.getPublicChannelUserProfile> }
>();

function readFallback(
  channelSlug: string,
  username: string,
  options: { fresh?: boolean; viewerId?: string } = {}
) {
  const key = `${options.viewerId ?? "public"}:${channelSlug.toLowerCase()}:${username.toLowerCase()}`;
  if (options.fresh) fallbackSnapshots.delete(key);
  const cached = fallbackSnapshots.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = kickClient.getPublicChannelUserProfile(channelSlug, username);
  fallbackSnapshots.set(key, { expiresAt: Date.now() + FALLBACK_COALESCE_MS, promise });
  return promise;
}

export function resetKickPublicProfileReaderCacheForTests(): void {
  fallbackSnapshots.clear();
}

function parseKickUserId(userId: string): number | null {
  const parsed = Number(userId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function getKickPublicIdentity(
  userId: string,
  username: string,
  channelSlug: string
): Promise<ProfileFieldState<KickPublicIdentity>> {
  const numericUserId = parseKickUserId(userId);
  let officialLookupFailed = false;
  if (numericUserId !== null) {
    try {
      const user = (await kickClient.getUsersByIdStrict([numericUserId])).find(
        (candidate) => candidate.user_id === numericUserId
      );
      if (user) {
        return {
          state: "known",
          source: "official",
          value: {
            userId: String(user.user_id),
            username: user.name.toLowerCase(),
            displayName: user.name,
            avatarUrl: user.profile_picture ?? "",
          },
        };
      }
    } catch {
      officialLookupFailed = true;
    }
  }

  try {
    const fallback = await readFallback(channelSlug, username, { viewerId: userId });
    if (
      fallback &&
      fallback.userId === userId &&
      fallback.username.toLowerCase() === username.toLowerCase()
    ) {
      return {
        state: "known",
        source: "first-party-fallback",
        value: {
          userId: fallback.userId,
          username: fallback.username,
          displayName: fallback.displayName,
          avatarUrl: fallback.avatarUrl,
        },
      };
    }
  } catch {
    return { state: "failed", message: "Couldn’t verify" };
  }

  return officialLookupFailed
    ? { state: "failed", message: "Couldn’t verify" }
    : { state: "unavailable", message: "Unavailable" };
}

export async function getKickAccountCreated(
  _userId: string,
  _username: string,
  _channelSlug: string
): Promise<AccountCreatedFieldState> {
  // Neither the documented Kick user/event contracts nor the validated
  // fallback currently provide an account-creation timestamp.
  return { state: "unavailable", message: "Unavailable" };
}

export async function getKickFollowRelationship(
  userId: string,
  username: string,
  channelSlug: string
): Promise<ProfileFieldState<string>> {
  try {
    const fallback = await readFallback(channelSlug, username, { viewerId: userId });
    if (
      fallback?.userId === userId &&
      fallback.username.toLowerCase() === username.toLowerCase() &&
      fallback.followingSince &&
      ISO_TIMESTAMP_PATTERN.test(fallback.followingSince) &&
      Number.isFinite(Date.parse(fallback.followingSince))
    ) {
      return {
        state: "known",
        source: "first-party-fallback",
        value: fallback.followingSince,
      };
    }
  } catch {
    // A fallback failure cannot prove a negative relationship.
  }
  return { state: "unavailable", message: "Unavailable" };
}

export type KickAccountFollowState = "followed" | "not-followed" | "unavailable";

export async function getKickAccountFollowState(
  userId: string,
  username: string,
  channelSlug: string,
  options: { fresh?: boolean } = {}
): Promise<KickAccountFollowState> {
  if (options.fresh) {
    try {
      return (
        (await getKickAccountFollowStates(userId, username, [channelSlug])).get(
          channelSlug.toLowerCase()
        ) ?? "unavailable"
      );
    } catch {
      return "unavailable";
    }
  }
  try {
    const fallback = await readFallback(channelSlug, username, { ...options, viewerId: userId });
    if (
      !fallback ||
      fallback.userId !== userId ||
      fallback.username.toLowerCase() !== username.toLowerCase()
    ) {
      return "unavailable";
    }
    if (fallback.followingSince === null) return "not-followed";
    if (
      fallback.followingSince &&
      ISO_TIMESTAMP_PATTERN.test(fallback.followingSince) &&
      Number.isFinite(Date.parse(fallback.followingSince))
    ) {
      return "followed";
    }
  } catch {
    // A failed first-party read cannot prove an unfollow.
  }
  return "unavailable";
}

export async function getKickAccountFollowStates(
  userId: string,
  username: string,
  channelSlugs: string[]
): Promise<Map<string, KickAccountFollowState>> {
  const states = new Map<string, KickAccountFollowState>();
  for (const slug of channelSlugs) states.set(slug.toLowerCase(), "unavailable");
  const profiles = await kickClient.getPublicChannelUserProfiles(
    channelSlugs.map((channelSlug) => ({ channelSlug, username }))
  );
  for (const { channelSlug, profile } of profiles) {
    let state: KickAccountFollowState = "unavailable";
    if (profile?.userId === userId && profile.username.toLowerCase() === username.toLowerCase()) {
      if (profile.followingSince === null) state = "not-followed";
      else if (
        profile.followingSince &&
        ISO_TIMESTAMP_PATTERN.test(profile.followingSince) &&
        Number.isFinite(Date.parse(profile.followingSince))
      ) {
        state = "followed";
      }
    }
    states.set(channelSlug.toLowerCase(), state);
  }
  return states;
}

export async function resolveKickPublicChannel(
  username: string
): Promise<ProfileFieldState<KickResolvedChannel>> {
  try {
    const channel = (await kickClient.getChannelsBySlugs([username])).find(
      (candidate) => candidate.username.toLowerCase() === username.toLowerCase()
    );
    if (channel) {
      return {
        state: "known",
        source: "official",
        value: {
          id: channel.id,
          username: channel.username,
          displayName: channel.displayName,
        },
      };
    }
  } catch {
    // Settle unavailable so external navigation and dismissal remain usable.
  }
  return { state: "unavailable", message: "Unavailable" };
}
