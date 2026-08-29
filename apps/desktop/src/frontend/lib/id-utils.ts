/**
 * ID Utilities
 *
 * Centralized functions for generating unique, platform-aware identifiers.
 * These utilities prevent key collisions when the same streamer is followed
 * on both Twitch and Kick platforms.
 *
 * IMPORTANT: Always use these functions when:
 * - Creating React element keys for channels/streams
 * - Storing or looking up channels/streams in Maps/Sets
 * - Comparing channels/streams for equality
 * - Checking follow status
 */

import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import type { Platform } from "@shared/auth-types";

/**
 * Creates a unique key for a channel that includes the platform.
 * This prevents collisions when a user follows the same streamer on both Twitch and Kick.
 *
 * @example
 * getChannelKey({ platform: 'twitch', id: '12345' }) // => 'twitch-12345'
 * getChannelKey({ platform: 'kick', id: '12345' })   // => 'kick-12345'
 */
export function getChannelKey(channel: Pick<UnifiedChannel, "platform" | "id">): string {
  return `${channel.platform}-${channel.id}`;
}

/**
 * Creates a unique key for a stream that includes the platform.
 * Uses channelId from the stream for consistency with channel keys.
 *
 * @example
 * getStreamKey({ platform: 'twitch', channelId: '12345' }) // => 'twitch-12345'
 */
export function getStreamKey(stream: Pick<UnifiedStream, "platform" | "channelId">): string {
  return `${stream.platform}-${stream.channelId}`;
}

/**
 * Creates a unique key for a stream using its own ID (not channel ID).
 * Use this for stream-specific operations like React keys in stream lists.
 *
 * @example
 * getStreamElementKey({ platform: 'twitch', id: 'stream123' }) // => 'twitch-stream123'
 */
export function getStreamElementKey(stream: Pick<UnifiedStream, "platform" | "id">): string {
  return `${stream.platform}-${stream.id}`;
}

/**
 * Creates a channel lookup key using platform and username (slug).
 * Usernames are lowercased for case-insensitive matching.
 *
 * @example
 * getChannelNameKey('twitch', 'xQc') // => 'twitch-xqc'
 */
export function getChannelNameKey(platform: Platform, username: string): string {
  return `${platform}-${username.toLowerCase()}`;
}

/**
 * Parses a platform-aware key back into its components.
 *
 * @example
 * parseKey('twitch-12345') // => { platform: 'twitch', id: '12345' }
 */
function parseKey(key: string): { platform: Platform; id: string } | null {
  const dashIndex = key.indexOf("-");
  if (dashIndex === -1) return null;

  const platform = key.substring(0, dashIndex) as Platform;
  const id = key.substring(dashIndex + 1);

  if (!id) return null;

  if (platform !== "twitch" && platform !== "kick") return null;

  return { platform, id };
}

/**
 * Checks if two channels are the same (same platform AND same ID).
 *
 * @example
 * isSameChannel(twitchXqc, kickXqc)   // => false (different platforms)
 * isSameChannel(twitchXqc, twitchXqc) // => true
 */
function isSameChannel(
  a: Pick<UnifiedChannel, "platform" | "id">,
  b: Pick<UnifiedChannel, "platform" | "id">
): boolean {
  return a.platform === b.platform && a.id === b.id;
}

/**
 * Match two channels as "the same" across views, robust to platforms that
 * expose multiple internal IDs for the same broadcaster. Kick has both a
 * `user_id` and a `channel.id` — older follow rows stored the former, fresh
 * API lookups return the latter, and the two numbers don't bridge. Matching
 * on (platform AND id) OR (platform AND username) is enough because the slug
 * is stable across the schema.
 */
export function channelsMatch(
  a: Pick<UnifiedChannel, "platform" | "id" | "username">,
  b: Pick<UnifiedChannel, "platform" | "id" | "username">
): boolean {
  if (a.platform !== b.platform) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.username && b.username && a.username.toLowerCase() === b.username.toLowerCase()) {
    return true;
  }
  return false;
}

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

export function streamsMatchChannelIdentity(
  a: Pick<UnifiedStream, "platform" | "channelId" | "channelName">,
  b: Pick<UnifiedStream, "platform" | "channelId" | "channelName">
): boolean {
  if (a.platform !== b.platform) return false;
  if (a.channelId && b.channelId && a.channelId === b.channelId) return true;
  return Boolean(
    a.channelName && b.channelName && a.channelName.toLowerCase() === b.channelName.toLowerCase()
  );
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
