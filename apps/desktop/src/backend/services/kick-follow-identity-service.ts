import { logger } from "@backend/logging/logger";
import {
  firstValidKickBroadcasterUserId,
  getKickBroadcasterUserIdFromAvatar,
} from "@/lib/kick-channel-identity";
import type { LocalFollow } from "../../shared/auth-types";
import type { UnifiedChannel } from "../../shared/platform-types";
import { isKickRateLimitError } from "../api/platforms/kick/kick-error-classification";
import { dbService } from "./database-service";
import { storageService } from "./storage-service";

export type KickFollowMetadataClient = {
  getChannelsByBroadcasterIds(broadcasterUserIds: number[]): Promise<UnifiedChannel[]>;
  getChannelsBySlugs?(slugs: string[]): Promise<UnifiedChannel[]>;
  getPublicChannel(slug: string): Promise<UnifiedChannel | null>;
};

type KickFollowVerificationEntry = {
  isVerified: boolean;
  verifiedAt: number;
};

type KickFollowVerificationCache = {
  version: 1;
  entries: Record<string, KickFollowVerificationEntry>;
  nextBackfillIndex: number;
};

const KICK_FOLLOW_VERIFICATION_CACHE_KEY = "kick-follow-verification-cache-v1";
const KICK_FOLLOW_VERIFICATION_CACHE_VERSION = 1;
const KICK_FOLLOW_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const KICK_FOLLOW_VERIFICATION_BATCH_SIZE = 3;

let verificationCacheCommitTail: Promise<void> = Promise.resolve();

function emptyVerificationCache(): KickFollowVerificationCache {
  return {
    version: KICK_FOLLOW_VERIFICATION_CACHE_VERSION,
    entries: {},
    nextBackfillIndex: 0,
  };
}

function parseVerificationCache(candidate: unknown): KickFollowVerificationCache | null {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("version" in candidate) ||
    candidate.version !== KICK_FOLLOW_VERIFICATION_CACHE_VERSION ||
    !("entries" in candidate) ||
    !candidate.entries ||
    typeof candidate.entries !== "object"
  ) {
    return null;
  }

  const entries: Record<string, KickFollowVerificationEntry> = {};
  for (const [broadcasterId, entry] of Object.entries(candidate.entries)) {
    if (
      entry &&
      typeof entry === "object" &&
      "isVerified" in entry &&
      typeof entry.isVerified === "boolean" &&
      "verifiedAt" in entry &&
      typeof entry.verifiedAt === "number" &&
      Number.isFinite(entry.verifiedAt)
    ) {
      entries[broadcasterId] = {
        isVerified: entry.isVerified,
        verifiedAt: entry.verifiedAt,
      };
    }
  }

  const nextBackfillIndex =
    "nextBackfillIndex" in candidate &&
    typeof candidate.nextBackfillIndex === "number" &&
    Number.isSafeInteger(candidate.nextBackfillIndex) &&
    candidate.nextBackfillIndex >= 0
      ? candidate.nextBackfillIndex
      : 0;

  return {
    version: KICK_FOLLOW_VERIFICATION_CACHE_VERSION,
    entries,
    nextBackfillIndex,
  };
}

function readVerificationCache(): KickFollowVerificationCache {
  return (
    dbService.get(KICK_FOLLOW_VERIFICATION_CACHE_KEY, parseVerificationCache) ??
    emptyVerificationCache()
  );
}

function isFreshVerification(entry: KickFollowVerificationEntry | undefined, now: number): boolean {
  return Boolean(entry && now - entry.verifiedAt <= KICK_FOLLOW_VERIFICATION_TTL_MS);
}

async function commitVerificationCache(
  updates: ReadonlyMap<string, KickFollowVerificationEntry>,
  attemptedCount: number,
  rotationSize: number
): Promise<void> {
  if (attemptedCount === 0 && updates.size === 0) return;

  const commit = verificationCacheCommitTail
    .catch(() => undefined)
    .then(() => {
      const latest = readVerificationCache();

      for (const [broadcasterId, update] of updates) {
        const existing = latest.entries[broadcasterId];
        if (!existing || existing.verifiedAt <= update.verifiedAt) {
          latest.entries[broadcasterId] = update;
        }
      }

      latest.nextBackfillIndex =
        rotationSize > 0
          ? (latest.nextBackfillIndex + attemptedCount) % rotationSize
          : latest.nextBackfillIndex;
      dbService.set(KICK_FOLLOW_VERIFICATION_CACHE_KEY, latest);
    });

  verificationCacheCommitTail = commit.catch(() => undefined);
  await commit;
}

function uniqueByLowercase(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(normalized);
    }
  }

  return unique;
}

export function parseKickBroadcasterUserId(channelId: string | undefined): number | null {
  if (!channelId) return null;

  const value = Number(channelId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function getKickResolutionBroadcasterUserId(
  follow: LocalFollow,
  allKickFollows: LocalFollow[]
): string | null {
  const directId = firstValidKickBroadcasterUserId(
    getKickBroadcasterUserIdFromAvatar(follow.profileImage),
    follow.channelId
  );
  if (directId) return directId;

  const slug = follow.channelName?.toLowerCase();
  if (!slug) return null;

  const siblingWithStableId = allKickFollows.find(
    (candidate) =>
      candidate.id !== follow.id &&
      candidate.channelName?.toLowerCase() === slug &&
      firstValidKickBroadcasterUserId(
        getKickBroadcasterUserIdFromAvatar(candidate.profileImage),
        candidate.channelId
      )
  );

  return siblingWithStableId
    ? firstValidKickBroadcasterUserId(
        getKickBroadcasterUserIdFromAvatar(siblingWithStableId.profileImage),
        siblingWithStableId.channelId
      )
    : null;
}

function preserveStoredDisplayName(current: UnifiedChannel, follow: LocalFollow): UnifiedChannel {
  const currentDisplayName = current.displayName?.trim();
  const storedDisplayName = follow.displayName?.trim();
  const username = current.username.trim();

  if (
    currentDisplayName === username &&
    storedDisplayName &&
    storedDisplayName.toLowerCase() === username.toLowerCase()
  ) {
    return { ...current, displayName: storedDisplayName };
  }

  return current;
}

function getKickProfileAssetIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "files.kick.com") return null;
    const userId = /\/images\/user\/(\d+)\/profile_image\//i.exec(url.pathname)?.[1];
    const assetId =
      /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-[^/.]+)?\.[^/]+$/i.exec(
        url.pathname
      )?.[1];
    return userId && assetId ? `${userId}:${assetId.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

function areEquivalentKickProfileImages(current: string, stored: string): boolean {
  if (current === stored) return true;
  const currentIdentity = getKickProfileAssetIdentity(current);
  return currentIdentity !== null && currentIdentity === getKickProfileAssetIdentity(stored);
}

export async function resolveKickFollowMetadata(
  kickClient: KickFollowMetadataClient,
  follows: LocalFollow[]
): Promise<Map<string, UnifiedChannel>> {
  const allKickFollows = storageService.getLocalFollowsByPlatform("kick");
  const storedFollowsById = new Map(allKickFollows.map((follow) => [follow.id, follow]));
  const resolutionIds = uniqueByLowercase(
    follows
      .map((follow) => getKickResolutionBroadcasterUserId(follow, allKickFollows) ?? "")
      .filter(Boolean)
  );
  const ids = resolutionIds.map(Number);
  const unresolvedSlugs = uniqueByLowercase(
    follows
      .filter((follow) => !getKickResolutionBroadcasterUserId(follow, allKickFollows))
      .map((follow) => follow.channelName)
  );

  let channels: UnifiedChannel[] = [];
  if (ids.length > 0) {
    try {
      channels = await kickClient.getChannelsByBroadcasterIds(ids);
    } catch (error) {
      const log = isKickRateLimitError(error) ? logger.debug : logger.warn;
      log("Service:KickFollowIdentity", "Failed to resolve Kick follow slugs by broadcaster ID", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  let slugChannels: UnifiedChannel[] = [];
  if (unresolvedSlugs.length > 0 && kickClient.getChannelsBySlugs) {
    try {
      slugChannels = await kickClient.getChannelsBySlugs(unresolvedSlugs);
    } catch (error) {
      const log = isKickRateLimitError(error) ? logger.debug : logger.warn;
      log("Service:KickFollowIdentity", "Failed to resolve legacy Kick follows by slug", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const channelsBySlug = new Map(
    slugChannels.map((channel) => [channel.username.toLowerCase(), channel])
  );
  const cache = readVerificationCache();
  const now = Date.now();
  const verificationByBroadcasterId = new Map<string, boolean>();
  const candidates = new Set<string>();

  for (const broadcasterUserId of resolutionIds) {
    const current = channelsById.get(broadcasterUserId);
    if (!current?.username) continue;

    const cached = cache.entries[broadcasterUserId];
    if (isFreshVerification(cached, now)) {
      verificationByBroadcasterId.set(broadcasterUserId, cached.isVerified);
    } else {
      candidates.add(broadcasterUserId);
    }
  }

  const prioritizedIds = resolutionIds.filter((broadcasterUserId) => {
    if (!candidates.has(broadcasterUserId)) return false;

    const current = channelsById.get(broadcasterUserId);
    return follows.some(
      (follow) =>
        getKickResolutionBroadcasterUserId(follow, allKickFollows) === broadcasterUserId &&
        current?.username.toLowerCase() !== follow.channelName.toLowerCase()
    );
  });
  const selectedIds = prioritizedIds.slice(0, KICK_FOLLOW_VERIFICATION_BATCH_SIZE);
  const selectedIdSet = new Set(selectedIds);
  const rotationStart =
    resolutionIds.length > 0 ? cache.nextBackfillIndex % resolutionIds.length : 0;

  for (
    let offset = 0;
    offset < resolutionIds.length && selectedIds.length < KICK_FOLLOW_VERIFICATION_BATCH_SIZE;
    offset += 1
  ) {
    const broadcasterUserId = resolutionIds[(rotationStart + offset) % resolutionIds.length];
    if (!candidates.has(broadcasterUserId) || selectedIdSet.has(broadcasterUserId)) continue;

    selectedIds.push(broadcasterUserId);
    selectedIdSet.add(broadcasterUserId);
  }

  const cacheUpdates = new Map<string, KickFollowVerificationEntry>();
  for (const broadcasterUserId of selectedIds) {
    const current = channelsById.get(broadcasterUserId);
    if (!current?.username) continue;

    try {
      const publicChannel = await kickClient.getPublicChannel(current.username);
      if (publicChannel?.kickUserId !== broadcasterUserId) continue;

      const entry = {
        isVerified: publicChannel.isVerified,
        verifiedAt: Date.now(),
      };
      cacheUpdates.set(broadcasterUserId, entry);
      verificationByBroadcasterId.set(broadcasterUserId, entry.isVerified);
    } catch (error) {
      logger.warn("Service:KickFollowIdentity", "Failed to verify Kick follow metadata", {
        broadcasterUserId,
        slug: current.username,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  await commitVerificationCache(cacheUpdates, selectedIds.length, resolutionIds.length);

  const channelsByFollowId = new Map<string, UnifiedChannel>();
  let updatedFollowCount = 0;
  const updatedFieldCounts = {
    channelId: 0,
    channelName: 0,
    displayName: 0,
    profileImage: 0,
  };

  for (const follow of follows) {
    const storedFollow = storedFollowsById.get(follow.id) ?? follow;
    const broadcasterUserId = getKickResolutionBroadcasterUserId(follow, allKickFollows);
    const resolved = broadcasterUserId
      ? channelsById.get(broadcasterUserId)
      : channelsBySlug.get(follow.channelName.toLowerCase());
    const current = resolved ? preserveStoredDisplayName(resolved, storedFollow) : undefined;
    if (!current?.username) continue;

    const isVerified = broadcasterUserId
      ? verificationByBroadcasterId.get(broadcasterUserId)
      : undefined;
    channelsByFollowId.set(
      follow.id,
      isVerified === undefined ? current : { ...current, isVerified }
    );

    const updates: Partial<LocalFollow> = {};
    if (current.id !== storedFollow.channelId) {
      updates.channelId = current.id;
    }
    if (current.username.toLowerCase() !== storedFollow.channelName.toLowerCase()) {
      updates.channelName = current.username;
    }
    if (current.displayName && current.displayName !== storedFollow.displayName) {
      updates.displayName = current.displayName;
    }
    if (
      storedFollow.source !== "kick" &&
      current.avatarUrl &&
      !areEquivalentKickProfileImages(current.avatarUrl, storedFollow.profileImage)
    ) {
      updates.profileImage = current.avatarUrl;
    }

    if (Object.keys(updates).length > 0) {
      storageService.updateLocalFollow(follow.id, updates);
      updatedFollowCount += 1;
      if (updates.channelId !== undefined) updatedFieldCounts.channelId += 1;
      if (updates.channelName !== undefined) updatedFieldCounts.channelName += 1;
      if (updates.displayName !== undefined) updatedFieldCounts.displayName += 1;
      if (updates.profileImage !== undefined) updatedFieldCounts.profileImage += 1;
    }
  }

  if (updatedFollowCount > 0) {
    logger.info("Service:KickFollowIdentity", "Kick follow metadata refresh completed", {
      requestedCount: follows.length,
      resolvedCount: channelsByFollowId.size,
      updatedCount: updatedFollowCount,
      updatedFieldCounts,
    });
  }

  return channelsByFollowId;
}

export async function buildKickFollowedChannelSnapshot(
  kickClient: KickFollowMetadataClient,
  follows: readonly LocalFollow[]
): Promise<UnifiedChannel[]> {
  const resolvedChannels = await resolveKickFollowMetadata(kickClient, [...follows]);

  return follows.map((follow) => {
    const current = resolvedChannels.get(follow.id);
    const broadcasterUserId = firstValidKickBroadcasterUserId(
      current?.kickUserId,
      getKickBroadcasterUserIdFromAvatar(current?.avatarUrl || follow.profileImage),
      follow.channelId
    );

    return {
      id: follow.channelId,
      platform: "kick",
      username: current?.username || follow.channelName,
      displayName: current?.displayName || follow.displayName || follow.channelName,
      avatarUrl: current?.avatarUrl || follow.profileImage || "",
      isLive: current?.isLive || false,
      isVerified: current?.isVerified || false,
      isPartner: current?.isPartner || false,
      kickUserId: broadcasterUserId ?? undefined,
      accountStatus: current ? "active" : "unavailable",
    } satisfies UnifiedChannel;
  });
}

export interface KickFollowStatusTargets {
  broadcasterUserIds: number[];
  fallbackSlugs: string[];
  allSlugs: string[];
}

/**
 * Separate verified broadcaster identities from legacy numeric-looking ids.
 * A stored Kick follow id is only safe for the official livestream endpoint
 * after the channel endpoint resolves it. Unresolved rows retain their slug as
 * a public status fallback instead of being silently classified as offline.
 */
export async function getKickFollowStatusTargets(
  kickClient: KickFollowMetadataClient,
  follows: LocalFollow[]
): Promise<KickFollowStatusTargets> {
  const resolvedChannels = await resolveKickFollowMetadata(kickClient, follows);
  const broadcasterUserIds: number[] = [];
  const fallbackSlugs: string[] = [];
  const allSlugs: string[] = [];

  for (const follow of follows) {
    const current = resolvedChannels.get(follow.id);
    const slug = current?.username || follow.channelName;
    allSlugs.push(slug);

    const resolvedBroadcasterUserId = current
      ? firstValidKickBroadcasterUserId(
          current.kickUserId,
          getKickBroadcasterUserIdFromAvatar(current.avatarUrl),
          current.id
        )
      : null;
    const parsedId = parseKickBroadcasterUserId(resolvedBroadcasterUserId ?? undefined);

    if (parsedId === null) fallbackSlugs.push(slug);
    else broadcasterUserIds.push(parsedId);
  }

  return {
    broadcasterUserIds: [...new Set(broadcasterUserIds)],
    fallbackSlugs: uniqueByLowercase(fallbackSlugs),
    allSlugs: uniqueByLowercase(allSlugs),
  };
}

export async function resolveKickFollowPlaybackSlug(
  kickClient: KickFollowMetadataClient,
  requestedSlug: string
): Promise<string | null> {
  const follows = storageService.getActiveFollowsByPlatform("kick");
  const follow = follows.find(
    (candidate) => candidate.channelName.toLowerCase() === requestedSlug.toLowerCase()
  );

  if (
    !follow ||
    !firstValidKickBroadcasterUserId(
      getKickBroadcasterUserIdFromAvatar(follow.profileImage),
      follow.channelId
    )
  ) {
    return null;
  }

  const resolvedChannels = await resolveKickFollowMetadata(kickClient, [follow]);
  return resolvedChannels.get(follow.id)?.username ?? null;
}
