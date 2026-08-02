import { normalizeSearchTokens } from "../../search/search-normalization";
import {
  normalizeUnifiedChannel,
  normalizeUnifiedClip,
  normalizeUnifiedStream,
  normalizeUnifiedVideo,
} from "../../search/search-result-validation";
import type {
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../api/unified/platform-types";

export {
  filterRankAndDeduplicateCategories,
  mergeExactCrossPlatformCategories,
  rankCategoryMatch,
} from "../../search/category-search-contract";
export { normalizeSearchTokens } from "../../search/search-normalization";
export {
  isValidUnifiedCategory,
  isValidUnifiedChannel,
  isValidUnifiedClip,
  isValidUnifiedStream,
  normalizeUnifiedCategory,
  normalizeUnifiedChannel,
  normalizeUnifiedClip,
  normalizeUnifiedStream,
  normalizeUnifiedVideo,
} from "../../search/search-result-validation";

export interface SearchMatchRank {
  tier: number;
  editDistance: number;
}

function normalizedPhrase(value: string): string {
  return normalizeSearchTokens(value).join(" ");
}

function isOneDamerauEdit(left: string, right: string): boolean {
  const lengthDelta = left.length - right.length;
  if (Math.abs(lengthDelta) > 1) return false;

  if (lengthDelta === 0) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    if (differences.length === 1) return true;
    return (
      differences.length === 2 &&
      differences[1] === differences[0] + 1 &&
      left[differences[0]] === right[differences[1]] &&
      left[differences[1]] === right[differences[0]]
    );
  }

  const longer = lengthDelta > 0 ? left : right;
  const shorter = lengthDelta > 0 ? right : left;
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

function tokenMatchDistance(token: string, field: string): number | null {
  let bestDistance: number | null = null;
  for (const candidate of normalizeSearchTokens(field)) {
    if (candidate.includes(token)) return 0;
    if (token.length >= 5 && isOneDamerauEdit(token, candidate)) bestDistance = 1;
  }
  return bestDistance;
}

function bestTokenDistance(token: string, fields: string[]): number | null {
  const distances = fields
    .map((field) => tokenMatchDistance(token, field))
    .filter((distance): distance is number => distance !== null);
  return distances.length === 0 ? null : Math.min(...distances);
}

export function rankChannelMatch(
  channel: Pick<UnifiedChannel, "username" | "displayName">,
  query: string
): SearchMatchRank | null {
  const queryTokens = normalizeSearchTokens(query);
  if (queryTokens.length === 0) return null;

  const fields = [channel.username, channel.displayName];
  if (queryTokens.length === 1 && Array.from(queryTokens[0]).length === 1) {
    return fields.some((field) => normalizedPhrase(field).startsWith(queryTokens[0]))
      ? { tier: 1, editDistance: 0 }
      : null;
  }

  let editDistance = 0;
  for (const token of queryTokens) {
    const distance = bestTokenDistance(token, fields);
    if (distance === null) return null;
    editDistance = Math.max(editDistance, distance);
  }

  const queryPhrase = queryTokens.join(" ");
  const normalizedFields = fields.map(normalizedPhrase);
  if (normalizedFields.includes(queryPhrase)) return { tier: 0, editDistance: 0 };
  if (normalizedFields.some((field) => field.startsWith(queryPhrase))) {
    return { tier: 1, editDistance: 0 };
  }
  return { tier: 2, editDistance };
}

export function rankStreamMatch(
  stream: Pick<
    UnifiedStream,
    "channelName" | "channelDisplayName" | "title" | "categoryName" | "tags" | "language"
  >,
  query: string
): SearchMatchRank | null {
  const queryTokens = normalizeSearchTokens(query);
  if (queryTokens.length === 0) return null;
  if (queryTokens.length === 1 && Array.from(queryTokens[0]).length === 1) return null;

  const identityFields = [stream.channelName, stream.channelDisplayName];
  const titleFields = [stream.title];
  const categoryFields = stream.categoryName ? [stream.categoryName] : [];
  const metadataFields = [...stream.tags, stream.language];
  const fieldGroups = [identityFields, titleFields, categoryFields, metadataFields];
  const queryPhrase = queryTokens.join(" ");
  const normalizedIdentityFields = identityFields.map(normalizedPhrase);
  if (normalizedIdentityFields.includes(queryPhrase)) {
    return { tier: 0, editDistance: 0 };
  }
  if (normalizedIdentityFields.some((field) => field.startsWith(queryPhrase))) {
    return { tier: 1, editDistance: 0 };
  }

  let tier = 0;
  let editDistance = 0;
  for (const token of queryTokens) {
    let tokenMatched = false;
    for (let groupIndex = 0; groupIndex < fieldGroups.length; groupIndex += 1) {
      const distance = bestTokenDistance(token, fieldGroups[groupIndex]);
      if (distance === null) continue;
      tier = Math.max(tier, groupIndex + 2);
      editDistance = Math.max(editDistance, distance);
      tokenMatched = true;
      break;
    }
    if (!tokenMatched) return null;
  }

  return { tier, editDistance };
}

export function rankVideoMatch(
  video: Pick<UnifiedVideo, "channelName" | "channelDisplayName" | "title">,
  query: string
): SearchMatchRank | null {
  const queryTokens = normalizeSearchTokens(query);
  if (queryTokens.length === 0) return null;
  if (queryTokens.length === 1 && Array.from(queryTokens[0]).length === 1) return null;

  const identityFields = [video.channelName, video.channelDisplayName];
  const titleFields = [video.title];
  const queryPhrase = queryTokens.join(" ");
  const normalizedIdentityFields = identityFields.map(normalizedPhrase);
  if (
    normalizedIdentityFields.includes(queryPhrase) ||
    titleFields.some((field) => normalizedPhrase(field) === queryPhrase)
  ) {
    return { tier: 0, editDistance: 0 };
  }
  if (normalizedIdentityFields.some((field) => field.startsWith(queryPhrase))) {
    return { tier: 1, editDistance: 0 };
  }

  let tier = 0;
  let editDistance = 0;
  for (const token of queryTokens) {
    const identityDistance = bestTokenDistance(token, identityFields);
    if (identityDistance !== null) {
      tier = Math.max(tier, 2);
      editDistance = Math.max(editDistance, identityDistance);
      continue;
    }
    const titleDistance = bestTokenDistance(token, titleFields);
    if (titleDistance === null) return null;
    tier = Math.max(tier, 3);
    editDistance = Math.max(editDistance, titleDistance);
  }
  return { tier, editDistance };
}

export function rankClipMatch(
  clip: Pick<UnifiedClip, "channelName" | "channelDisplayName" | "title">,
  query: string
): SearchMatchRank | null {
  return rankVideoMatch(clip, query);
}

function compareMatchRank(
  left: { rank: SearchMatchRank; popularity: number; stableKey: string },
  right: { rank: SearchMatchRank; popularity: number; stableKey: string }
): number {
  return (
    left.rank.tier - right.rank.tier ||
    left.rank.editDistance - right.rank.editDistance ||
    right.popularity - left.popularity ||
    left.stableKey.localeCompare(right.stableKey)
  );
}

export function filterRankAndDeduplicateChannels(
  channels: readonly unknown[],
  query: string
): UnifiedChannel[] {
  const byIdentity = new Map<string, UnifiedChannel>();
  for (const value of channels) {
    const channel = normalizeUnifiedChannel(value);
    if (!channel) continue;
    const identity = `${channel.platform}:${channel.id}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, channel);
  }

  return Array.from(byIdentity.values())
    .map((channel) => ({
      channel,
      rank: rankChannelMatch(channel, query),
      popularity: channel.followerCount ?? channel.viewCount ?? channel.subscriberCount ?? 0,
      stableKey: `${normalizedPhrase(channel.username)}:${channel.platform}:${channel.id}`,
    }))
    .filter((entry): entry is typeof entry & { rank: SearchMatchRank } => entry.rank !== null)
    .sort(compareMatchRank)
    .map((entry) => entry.channel);
}

export function filterRankAndDeduplicateStreams(
  streams: readonly unknown[],
  query: string
): UnifiedStream[] {
  const byIdentity = new Map<string, UnifiedStream>();
  for (const value of streams) {
    const stream = normalizeUnifiedStream(value);
    if (!stream || !stream.isLive) continue;
    const identity = `${stream.platform}:${stream.id}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, stream);
  }

  return Array.from(byIdentity.values())
    .map((stream) => ({
      stream,
      rank: rankStreamMatch(stream, query),
      popularity: stream.viewerCount,
      stableKey: `${normalizedPhrase(stream.channelName)}:${stream.platform}:${stream.id}`,
    }))
    .filter((entry): entry is typeof entry & { rank: SearchMatchRank } => entry.rank !== null)
    .sort(compareMatchRank)
    .map((entry) => entry.stream);
}

export function filterRankAndDeduplicateVideos(
  videos: readonly unknown[],
  query: string
): UnifiedVideo[] {
  const byIdentity = new Map<string, UnifiedVideo>();
  for (const value of videos) {
    const video = normalizeUnifiedVideo(value);
    if (!video) continue;
    const identity = `${video.platform}:${video.id}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, video);
  }

  return Array.from(byIdentity.values())
    .map((video) => ({
      video,
      rank: rankVideoMatch(video, query),
      publishedAt: Date.parse(video.publishedAt),
      popularity: video.viewCount,
      stableKey: `${normalizedPhrase(video.channelName)}:${video.platform}:${video.id}`,
    }))
    .filter((entry): entry is typeof entry & { rank: SearchMatchRank } => entry.rank !== null)
    .sort(
      (left, right) =>
        left.rank.tier - right.rank.tier ||
        left.rank.editDistance - right.rank.editDistance ||
        right.popularity - left.popularity ||
        right.publishedAt - left.publishedAt ||
        left.stableKey.localeCompare(right.stableKey)
    )
    .map((entry) => entry.video);
}

export function filterRankAndDeduplicateClips(
  clips: readonly unknown[],
  query: string
): UnifiedClip[] {
  const byIdentity = new Map<string, UnifiedClip>();
  for (const value of clips) {
    const clip = normalizeUnifiedClip(value);
    if (!clip) continue;
    const identity = `${clip.platform}:${clip.id}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, clip);
  }

  return Array.from(byIdentity.values())
    .map((clip) => ({
      clip,
      rank: rankClipMatch(clip, query),
      createdAt: Date.parse(clip.createdAt),
      popularity: clip.viewCount,
      stableKey: `${normalizedPhrase(clip.channelName)}:${clip.platform}:${clip.id}`,
    }))
    .filter((entry): entry is typeof entry & { rank: SearchMatchRank } => entry.rank !== null)
    .sort(
      (left, right) =>
        left.rank.tier - right.rank.tier ||
        left.rank.editDistance - right.rank.editDistance ||
        right.popularity - left.popularity ||
        right.createdAt - left.createdAt ||
        left.stableKey.localeCompare(right.stableKey)
    )
    .map((entry) => entry.clip);
}
