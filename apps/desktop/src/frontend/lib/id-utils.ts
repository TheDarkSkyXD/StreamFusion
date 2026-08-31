import { channelsMatch, streamsMatchChannelIdentity } from "@streamfusion/core/platform";
import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";

export {
  channelsMatch,
  getChannelKey,
  getChannelNameKey,
  getStreamElementKey,
  getStreamKey,
  streamsMatchChannelIdentity,
} from "@streamfusion/core/platform";

function channelMetadataScore(channel: UnifiedChannel): number {
  let score = 0;
  if (channel.id) score += 1;
  if (channel.username) score += 1;
  if (channel.displayName && channel.displayName !== channel.username) score += 1;
  if (channel.avatarUrl) score += 2;
  if (channel.bannerUrl) score += 1;
  if (channel.bio) score += 1;
  if (channel.isLive) score += 1;
  if (channel.isVerified) score += 1;
  if (channel.isPartner) score += 1;
  return score;
}

function mergeDuplicateChannel(existing: UnifiedChannel, incoming: UnifiedChannel): UnifiedChannel {
  const primary =
    channelMetadataScore(incoming) > channelMetadataScore(existing) ? incoming : existing;
  const fallback = primary === incoming ? existing : incoming;

  return {
    ...primary,
    id: primary.id || fallback.id,
    username: primary.username || fallback.username,
    displayName: primary.displayName || fallback.displayName,
    avatarUrl: primary.avatarUrl || fallback.avatarUrl,
    bannerUrl: primary.bannerUrl || fallback.bannerUrl,
    bio: primary.bio || fallback.bio,
    isLive: Boolean(primary.isLive || fallback.isLive),
    isVerified: Boolean(primary.isVerified || fallback.isVerified),
    isPartner: Boolean(primary.isPartner || fallback.isPartner),
    kickUserId: primary.kickUserId || fallback.kickUserId,
  };
}

/**
 * Dedupe followed channels by real identity, not only by current API id.
 * Platform stays part of the match so a Twitch creator and Kick creator with
 * the same name remain separate, while duplicate Kick rows with different
 * internal ids collapse when their slug matches.
 */
export function dedupeChannelsByIdentity(channels: UnifiedChannel[]): UnifiedChannel[] {
  const deduped: UnifiedChannel[] = [];

  for (const channel of channels) {
    const existingIndex = deduped.findIndex((candidate) => channelsMatch(candidate, channel));
    if (existingIndex === -1) {
      deduped.push(channel);
      continue;
    }

    deduped[existingIndex] = mergeDuplicateChannel(deduped[existingIndex], channel);
  }

  return deduped;
}

function streamMetadataScore(stream: UnifiedStream): number {
  let score = 0;
  if (stream.channelId) score += 1;
  if (stream.channelName) score += 1;
  if (stream.channelDisplayName && stream.channelDisplayName !== stream.channelName) score += 1;
  if (stream.channelAvatar) score += 2;
  if (stream.thumbnailUrl) score += 2;
  if (stream.title) score += 1;
  if (stream.categoryId || stream.categoryName) score += 1;
  if (stream.startedAt) score += 1;
  if (stream.channelIsVerified) score += 1;
  return score;
}

function mergeDuplicateStream(existing: UnifiedStream, incoming: UnifiedStream): UnifiedStream {
  const incomingIsRicher = streamMetadataScore(incoming) > streamMetadataScore(existing);
  const primary = incomingIsRicher ? incoming : existing;
  const fallback = incomingIsRicher ? existing : incoming;

  return {
    ...fallback,
    ...primary,
    id: primary.id || fallback.id,
    channelId: primary.channelId || fallback.channelId,
    channelName: primary.channelName || fallback.channelName,
    channelDisplayName: primary.channelDisplayName || fallback.channelDisplayName,
    channelAvatar: primary.channelAvatar || fallback.channelAvatar,
    channelIsVerified: Boolean(primary.channelIsVerified || fallback.channelIsVerified),
    title: primary.title || fallback.title,
    viewerCount: Math.max(primary.viewerCount || 0, fallback.viewerCount || 0),
    thumbnailUrl: primary.thumbnailUrl || fallback.thumbnailUrl,
    isLive: Boolean(primary.isLive || fallback.isLive),
    startedAt: primary.startedAt || fallback.startedAt,
    language: primary.language || fallback.language,
    tags:
      Array.isArray(primary.tags) && primary.tags.length > 0
        ? primary.tags
        : Array.isArray(fallback.tags)
          ? fallback.tags
          : [],
    categoryId: primary.categoryId || fallback.categoryId,
    categoryName: primary.categoryName || fallback.categoryName,
  };
}

/**
 * Collapse live results by broadcaster identity. Kick's authenticated and
 * public endpoints can describe one channel with different numeric ids, but
 * the platform-scoped channel slug remains the shared identity.
 */
export function dedupeStreamsByChannelIdentity(streams: UnifiedStream[]): UnifiedStream[] {
  const deduped: UnifiedStream[] = [];

  for (const stream of streams) {
    const existingIndex = deduped.findIndex((candidate) =>
      streamsMatchChannelIdentity(candidate, stream)
    );
    if (existingIndex === -1) {
      deduped.push(stream);
      continue;
    }

    deduped[existingIndex] = mergeDuplicateStream(deduped[existingIndex], stream);
  }

  return deduped;
}
