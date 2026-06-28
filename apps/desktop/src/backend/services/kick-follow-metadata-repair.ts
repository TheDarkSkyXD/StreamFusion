import { logger } from "@/backend/logging/logger";
import type { LocalFollow } from "../../shared/auth-types";
import type { UnifiedChannel } from "../api/unified/platform-types";
import { storageService } from "./storage-service";

type KickFollowRepairClient = {
  getChannelsByBroadcasterIds(broadcasterUserIds: number[]): Promise<UnifiedChannel[]>;
};

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
  const ids = uniqueByLowercase(
    follows
      .map((follow) => getKickRepairBroadcasterUserId(follow, allKickFollows) ?? "")
      .filter(Boolean)
  ).map(Number);

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
  const channelsByFollowId = new Map<string, UnifiedChannel>();

  for (const follow of follows) {
    const repairId = getKickRepairBroadcasterUserId(follow, allKickFollows);
    if (!repairId) continue;

    const current = channelsById.get(repairId);
    if (!current?.username) continue;

    channelsByFollowId.set(follow.id, current);

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
