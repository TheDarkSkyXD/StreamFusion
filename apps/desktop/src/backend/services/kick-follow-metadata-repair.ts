import { logger } from "@/backend/logging/logger";
import type { LocalFollow } from "../../shared/auth-types";
import type { UnifiedChannel } from "../api/unified/platform-types";
import { dbService } from "./database-service";
import { storageService } from "./storage-service";

type KickFollowRepairClient = {
  getChannelsByBroadcasterIds(broadcasterUserIds: number[]): Promise<UnifiedChannel[]>;
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

function readVerificationCache(): KickFollowVerificationCache {
  const stored = dbService.get<unknown>(KICK_FOLLOW_VERIFICATION_CACHE_KEY);
  if (!stored || typeof stored !== "object") {
    return emptyVerificationCache();
  }

  const candidate = stored as Partial<KickFollowVerificationCache>;
  if (
    candidate.version !== KICK_FOLLOW_VERIFICATION_CACHE_VERSION ||
    !candidate.entries ||
    typeof candidate.entries !== "object"
  ) {
    return emptyVerificationCache();
  }

  const entries: Record<string, KickFollowVerificationEntry> = {};
  for (const [broadcasterId, entry] of Object.entries(candidate.entries)) {
    if (
      entry &&
      typeof entry.isVerified === "boolean" &&
      Number.isFinite(entry.verifiedAt)
    ) {
      entries[broadcasterId] = entry;
    }
  }

  return {
    version: KICK_FOLLOW_VERIFICATION_CACHE_VERSION,
    entries,
    nextBackfillIndex:
      Number.isSafeInteger(candidate.nextBackfillIndex) && candidate.nextBackfillIndex! >= 0
        ? candidate.nextBackfillIndex!
        : 0,
  };
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

  const commit = verificationCacheCommitTail.catch(() => undefined).then(() => {
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

function getKickRepairBroadcasterUserId(
  follow: LocalFollow,
  allKickFollows: LocalFollow[]
): string | null {
  const directId = parseKickBroadcasterUserId(follow.channelId);
  if (directId) return directId.toString();

  const slug = follow.channelName?.toLowerCase();
  if (!slug) return null;

  const siblingWithStableId = allKickFollows.find(
    (candidate) =>
      candidate.id !== follow.id &&
      candidate.channelName?.toLowerCase() === slug &&
      parseKickBroadcasterUserId(candidate.channelId)
  );

  return siblingWithStableId
    ? (parseKickBroadcasterUserId(siblingWithStableId.channelId)?.toString() ?? null)
    : null;
}

export async function repairKickFollowSlugs(
  kickClient: KickFollowRepairClient,
  follows: LocalFollow[]
): Promise<Map<string, UnifiedChannel>> {
  const allKickFollows = storageService.getLocalFollowsByPlatform("kick");
  const repairIds = uniqueByLowercase(
    follows
      .map((follow) => getKickRepairBroadcasterUserId(follow, allKickFollows) ?? "")
      .filter(Boolean)
  );
  const ids = repairIds.map(Number);

  if (ids.length === 0) {
    return new Map();
  }

  let channels: UnifiedChannel[] = [];
  try {
    channels = await kickClient.getChannelsByBroadcasterIds(ids);
  } catch (error) {
    logger.warn("IPC:KickFollowRepair", "Failed to resolve Kick follow slugs by broadcaster ID", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return new Map();
  }

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const cache = readVerificationCache();
  const now = Date.now();
  const verificationByBroadcasterId = new Map<string, boolean>();
  const candidates = new Set<string>();

  for (const repairId of repairIds) {
    const current = channelsById.get(repairId);
    if (!current?.username) continue;

    const cached = cache.entries[repairId];
    if (isFreshVerification(cached, now)) {
      verificationByBroadcasterId.set(repairId, cached.isVerified);
    } else {
      candidates.add(repairId);
    }
  }

  const prioritizedIds = repairIds.filter((repairId) => {
    if (!candidates.has(repairId)) return false;

    const current = channelsById.get(repairId);
    return follows.some(
      (follow) =>
        getKickRepairBroadcasterUserId(follow, allKickFollows) === repairId &&
        current?.username.toLowerCase() !== follow.channelName.toLowerCase()
    );
  });
  const selectedIds = prioritizedIds.slice(0, KICK_FOLLOW_VERIFICATION_BATCH_SIZE);
  const selectedIdSet = new Set(selectedIds);
  const rotationStart = repairIds.length > 0 ? cache.nextBackfillIndex % repairIds.length : 0;

  for (
    let offset = 0;
    offset < repairIds.length && selectedIds.length < KICK_FOLLOW_VERIFICATION_BATCH_SIZE;
    offset += 1
  ) {
    const repairId = repairIds[(rotationStart + offset) % repairIds.length];
    if (!candidates.has(repairId) || selectedIdSet.has(repairId)) continue;

    selectedIds.push(repairId);
    selectedIdSet.add(repairId);
  }

  const cacheUpdates = new Map<string, KickFollowVerificationEntry>();
  for (const repairId of selectedIds) {
    const current = channelsById.get(repairId);
    if (!current?.username) continue;

    try {
      const publicChannel = await kickClient.getPublicChannel(current.username);
      if (publicChannel?.kickUserId !== repairId) continue;

      const entry = {
        isVerified: publicChannel.isVerified,
        verifiedAt: Date.now(),
      };
      cacheUpdates.set(repairId, entry);
      verificationByBroadcasterId.set(repairId, entry.isVerified);
    } catch (error) {
      logger.warn("IPC:KickFollowRepair", "Failed to verify Kick follow metadata", {
        broadcasterUserId: repairId,
        slug: current.username,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  await commitVerificationCache(cacheUpdates, selectedIds.length, repairIds.length);

  const channelsByFollowId = new Map<string, UnifiedChannel>();

  for (const follow of follows) {
    const repairId = getKickRepairBroadcasterUserId(follow, allKickFollows);
    if (!repairId) continue;

    const current = channelsById.get(repairId);
    if (!current?.username) continue;

    const isVerified = verificationByBroadcasterId.get(repairId);
    channelsByFollowId.set(
      follow.id,
      isVerified === undefined ? current : { ...current, isVerified }
    );

    const updates: Partial<LocalFollow> = {};
    if (current.id !== follow.channelId) {
      updates.channelId = current.id;
    }
    if (current.username.toLowerCase() !== follow.channelName.toLowerCase()) {
      updates.channelName = current.username;
    }
    if (current.displayName && current.displayName !== follow.displayName) {
      updates.displayName = current.displayName;
    }
    if (current.avatarUrl && current.avatarUrl !== follow.profileImage) {
      updates.profileImage = current.avatarUrl;
    }

    if (Object.keys(updates).length > 0) {
      storageService.updateLocalFollow(follow.id, updates);
      logger.info("IPC:KickFollowRepair", "Updated stale Kick follow metadata", {
        followId: follow.id,
        channelId: follow.channelId,
        oldSlug: follow.channelName,
        newSlug: updates.channelName ?? follow.channelName,
      });
    }
  }

  return channelsByFollowId;
}

export async function getKickFollowScanSlugs(
  kickClient: KickFollowRepairClient,
  follows: LocalFollow[]
): Promise<string[]> {
  const repairedChannels = await repairKickFollowSlugs(kickClient, follows);

  return uniqueByLowercase(
    follows.map((follow) => repairedChannels.get(follow.id)?.username ?? follow.channelName)
  );
}

export async function resolveKickFollowPlaybackSlug(
  kickClient: KickFollowRepairClient,
  requestedSlug: string
): Promise<string | null> {
  const follows = storageService.getActiveFollowsByPlatform("kick");
  const follow = follows.find(
    (candidate) => candidate.channelName.toLowerCase() === requestedSlug.toLowerCase()
  );

  if (!follow || !parseKickBroadcasterUserId(follow.channelId)) {
    return null;
  }

  const repairedChannels = await repairKickFollowSlugs(kickClient, [follow]);
  return repairedChannels.get(follow.id)?.username ?? null;
}
