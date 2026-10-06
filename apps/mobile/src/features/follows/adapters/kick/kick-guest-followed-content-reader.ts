import type { Channel, Stream } from "@streamfusion/core/content";
import type { FollowedIdentityRef } from "@streamfusion/core/relay";

import type {
  LiveStreamCatalog,
  LiveStreamCatalogEntry,
} from "@mobile/features/discovery/capabilities/live-stream-catalog";
import {
  kickPublicChannelUrl,
  mapKickPublicChannel,
  mapKickPublicLive,
} from "@mobile/features/discovery/adapters/kick/kick-public-catalog";
import { readKickPublicChannelVideos } from "@mobile/features/discovery/adapters/kick/kick-public-videos";

import type {
  FollowedContentReader,
  FollowedReadOutcome,
} from "../../capabilities/following-session";
import { requestInit } from "../../utils/following-query";
import { failedRecorded } from "../relay/followed-content-parse";

export function createKickGuestFollowedContentReader(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly liveCatalog: LiveStreamCatalog;
}): FollowedContentReader {
  return {
    async readStreams(read) {
      if (read.platform !== "kick") return failedRead(read.refs);
      const catalog = await input.liveCatalog.read(signalInput(read.signal));
      if (read.signal?.aborted) return failedRead(read.refs);
      const entries = catalog.kind === "ready" ? catalog.entries : [];
      const streams: Stream[] = matchingEntries(entries, read.refs).map(
        (entry) => entry.stream,
      );
      const channels: Channel[] = matchingEntries(entries, read.refs).map(
        (entry) => entry.channel,
      );
      let failed = false;
      for (const ref of read.refs) {
        if (
          ref.kind === "id" ||
          channels.some((channel) => matchesRef(channel, ref))
        ) {
          continue;
        }
        const result = await readPublicChannel(
          input.fetch,
          ref.value,
          read.signal,
        );
        if (result.kind === "failed") {
          failed = true;
          continue;
        }
        if (result.channel !== null) channels.push(result.channel);
        if (result.live !== null) streams.push(result.live);
      }
      if (
        failed ||
        (catalog.kind !== "ready" &&
          channels.length === 0 &&
          read.refs.some((ref) => ref.kind === "id"))
      ) {
        return streams.length === 0
          ? failedRead(read.refs)
          : partialRead(streams, missingRefs(channels, read.refs));
      }
      return completeRead(
        uniqueById(streams, (stream) => stream.id),
        missingRefs(channels, read.refs),
      );
    },
    async readChannels(read) {
      if (read.platform !== "kick") return failedRead(read.refs);
      const catalog = await input.liveCatalog.read(signalInput(read.signal));
      if (read.signal?.aborted) return failedRead(read.refs);
      const entries = catalog.kind === "ready" ? catalog.entries : [];
      const channels = matchingEntries(entries, read.refs).map(
        (entry) => entry.channel,
      );
      const missing: FollowedIdentityRef[] = [];
      for (const ref of read.refs) {
        if (entries.some((entry) => matchesRef(entry.channel, ref))) continue;
        if (ref.kind === "id") {
          missing.push(ref);
          continue;
        }
        const result = await readPublicChannel(
          input.fetch,
          ref.value,
          read.signal,
        );
        if (result.kind === "failed") return failedRead(read.refs);
        if (result.channel === null) missing.push(ref);
        else channels.push(result.channel);
      }
      if (
        read.refs.length > 0 &&
        read.refs.every((ref) => ref.kind === "id") &&
        channels.length === 0
      ) {
        return failedRead(read.refs);
      }
      return completeRead(
        uniqueById(channels, (channel) => channel.id),
        missing,
      );
    },
    async readVideos(read) {
      if (read.platform !== "kick" || !read.channelLogin?.trim()) {
        return failedRecorded(read.platform, read.channelId);
      }
      const outcome = await readKickPublicChannelVideos({
        fetchImpl: input.fetch,
        slug: read.channelLogin.trim().toLowerCase(),
        ...(read.signal === undefined ? {} : { signal: read.signal }),
      });
      if (outcome.status === "failed") {
        return failedRecorded("kick", read.channelId);
      }
      const items = outcome.items
        .map((video) => ({ ...video, channelId: read.channelId }))
        .sort((left, right) =>
          read.sort === "views"
            ? right.viewCount - left.viewCount
            : right.publishedAt.localeCompare(left.publishedAt),
        );
      return {
        channelId: read.channelId,
        failed: false,
        items,
        offline: false,
        platform: "kick",
        stale: false,
        supported: true,
      };
    },
    readClips: (read) =>
      Promise.resolve(failedRecorded(read.platform, read.channelId)),
  };
}

async function readPublicChannel(
  fetchImpl: typeof globalThis.fetch,
  slug: string,
  signal?: AbortSignal,
): Promise<
  | {
      readonly kind: "ready";
      readonly channel: Channel | null;
      readonly live: Stream | null;
    }
  | { readonly kind: "failed" }
> {
  try {
    const response = await fetchImpl(
      kickPublicChannelUrl(slug),
      requestInit({ Accept: "application/json" }, signal),
    );
    if (response.status === 404)
      return { kind: "ready", channel: null, live: null };
    if (!response.ok || signal?.aborted) return { kind: "failed" };
    const payload: unknown = await response.json();
    const channel = mapKickPublicChannel(payload);
    return channel === null
      ? { kind: "failed" }
      : { kind: "ready", channel, live: mapKickPublicLive(payload, channel) };
  } catch {
    return { kind: "failed" };
  }
}

function matchingEntries(
  entries: readonly LiveStreamCatalogEntry[],
  refs: readonly FollowedIdentityRef[],
): readonly LiveStreamCatalogEntry[] {
  return uniqueById(
    entries.filter((entry) =>
      refs.some((ref) => matchesRef(entry.channel, ref)),
    ),
    (entry) => entry.channel.id,
  );
}

function matchesRef(channel: Channel, ref: FollowedIdentityRef): boolean {
  return ref.kind === "id"
    ? channel.id === ref.value
    : channel.username.toLowerCase() === ref.value.toLowerCase();
}

function missingRefs(
  channels: readonly Channel[],
  refs: readonly FollowedIdentityRef[],
): readonly FollowedIdentityRef[] {
  return refs.filter(
    (ref) => !channels.some((channel) => matchesRef(channel, ref)),
  );
}

function uniqueById<T>(
  items: readonly T[],
  key: (item: T) => string,
): readonly T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function completeRead<T>(
  items: readonly T[],
  missing: readonly FollowedIdentityRef[],
): FollowedReadOutcome<T> {
  return {
    items,
    missing,
    offline: false,
    platform: "kick",
    retryable: false,
    stale: false,
    status: "complete",
  };
}

function partialRead<T>(
  items: readonly T[],
  missing: readonly FollowedIdentityRef[],
): FollowedReadOutcome<T> {
  return {
    ...completeRead(items, missing),
    error: "kick-public-unavailable",
    retryable: true,
    status: "partial",
  };
}

function failedRead<T>(
  missing: readonly FollowedIdentityRef[],
): FollowedReadOutcome<T> {
  return {
    error: "kick-public-unavailable",
    items: [],
    missing,
    offline: false,
    platform: "kick",
    retryable: true,
    stale: false,
    status: "failed",
  };
}

function signalInput(signal?: AbortSignal): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}
