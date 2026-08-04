import type { UnifiedChannel } from "../backend/api/unified/platform-types";

import { compactSearchIdentity, normalizeSearchTokens } from "./search-normalization";

export interface ChannelSearchRank {
  tier: number;
  editDistance: number;
}

type ChannelSearchIdentity = Pick<UnifiedChannel, "username" | "displayName">;

function normalizedPhrase(value: string): string {
  return normalizeSearchTokens(value).join(" ");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isExactChannelSearchMatch(
  channel: ChannelSearchIdentity,
  query: string
): boolean {
  const queryIdentity = compactSearchIdentity(query);
  return (
    queryIdentity.length > 0 &&
    [channel.username, channel.displayName].some(
      (field) => compactSearchIdentity(field) === queryIdentity
    )
  );
}

function isOneDamerauEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    return (
      differences.length === 1 ||
      (differences.length === 2 &&
        differences[1] === differences[0] + 1 &&
        left[differences[0]] === right[differences[1]] &&
        left[differences[1]] === right[differences[0]])
    );
  }

  const longer = left.length > right.length ? left : right;
  const shorter = left.length > right.length ? right : left;
  let longerIndex = 0;
  let shorterIndex = 0;
  let skipped = false;
  while (longerIndex < longer.length && shorterIndex < shorter.length) {
    if (longer[longerIndex] === shorter[shorterIndex]) {
      longerIndex += 1;
      shorterIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longerIndex += 1;
  }
  return true;
}

function tokenDistance(token: string, field: string): number | null {
  let fuzzy = false;
  for (const candidate of normalizeSearchTokens(field)) {
    if (candidate.includes(token)) return 0;
    if (token.length >= 5 && isOneDamerauEdit(token, candidate)) fuzzy = true;
  }
  return fuzzy ? 1 : null;
}

export function rankChannelMatch(
  channel: ChannelSearchIdentity,
  query: string
): ChannelSearchRank | null {
  const queryTokens = normalizeSearchTokens(query);
  if (queryTokens.length === 0) return null;
  const fields = [channel.username, channel.displayName];
  const queryIdentity = compactSearchIdentity(query);
  if (fields.some((field) => compactSearchIdentity(field) === queryIdentity)) {
    return { tier: 0, editDistance: 0 };
  }
  if (fields.some((field) => compactSearchIdentity(field).startsWith(queryIdentity))) {
    return { tier: 1, editDistance: 0 };
  }
  if (queryTokens.length === 1 && queryTokens[0].length === 1) return null;

  let editDistance = 0;
  for (const token of queryTokens) {
    const distances = fields
      .map((field) => tokenDistance(token, field))
      .filter((distance): distance is number => distance !== null);
    if (distances.length === 0) return null;
    editDistance = Math.max(editDistance, Math.min(...distances));
  }
  return { tier: 2, editDistance };
}

function trustworthyFollowerCount(channel: UnifiedChannel): number | undefined {
  const count = channel.followerCount;
  return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : undefined;
}

function compareStableChannelIdentity(left: UnifiedChannel, right: UnifiedChannel): number {
  return (
    compareText(normalizedPhrase(left.displayName), normalizedPhrase(right.displayName)) ||
    compareText(normalizedPhrase(left.username), normalizedPhrase(right.username)) ||
    compareText(left.platform, right.platform) ||
    compareText(left.id, right.id)
  );
}

function duplicateFingerprint(channel: UnifiedChannel): string {
  return [
    channel.displayName,
    channel.username,
    channel.avatarUrl,
    channel.bannerUrl ?? "",
    channel.bio ?? "",
    String(channel.isLive),
    String(channel.isVerified),
    String(channel.isPartner),
  ].join("\u0000");
}

function compareDuplicateQuality(left: UnifiedChannel, right: UnifiedChannel): number {
  const leftFollowers = trustworthyFollowerCount(left);
  const rightFollowers = trustworthyFollowerCount(right);
  return (
    Number(leftFollowers === undefined) - Number(rightFollowers === undefined) ||
    (rightFollowers ?? 0) - (leftFollowers ?? 0) ||
    Number(!left.avatarUrl) - Number(!right.avatarUrl) ||
    compareText(duplicateFingerprint(left), duplicateFingerprint(right))
  );
}

export function rankSearchChannels(
  channels: readonly UnifiedChannel[],
  query: string
): UnifiedChannel[] {
  const byIdentity = new Map<string, UnifiedChannel>();
  for (const channel of channels) {
    const identity = `${channel.platform}:${channel.id}`;
    const existing = byIdentity.get(identity);
    if (!existing || compareDuplicateQuality(channel, existing) < 0) {
      byIdentity.set(identity, channel);
    }
  }

  const rankedChannels: Array<{
    channel: UnifiedChannel;
    rank: ChannelSearchRank;
    followerCount: number | undefined;
  }> = [];
  for (const channel of byIdentity.values()) {
    const rank = rankChannelMatch(channel, query);
    if (!rank) continue;
    rankedChannels.push({
      channel,
      rank,
      followerCount: trustworthyFollowerCount(channel),
    });
  }

  return rankedChannels
    .sort(
      (left, right) =>
        left.rank.tier - right.rank.tier ||
        left.rank.editDistance - right.rank.editDistance ||
        Number(left.followerCount === undefined) - Number(right.followerCount === undefined) ||
        (right.followerCount ?? 0) - (left.followerCount ?? 0) ||
        compareStableChannelIdentity(left.channel, right.channel)
    )
    .map((entry) => entry.channel);
}
