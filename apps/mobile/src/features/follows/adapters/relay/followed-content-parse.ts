import type { Channel, Clip, Stream, Video } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";
import {
  followedChannelsBodySchema,
  followedClipsBodySchema,
  followedStreamsBodySchema,
  followedVideosBodySchema,
  relayResponseEnvelopeSchema,
  type FollowedIdentityRef,
} from "@streamfusion/core/relay";

import type {
  FollowedReadOutcome,
  FollowedRecordedOutcome,
} from "../../capabilities/following-session";

export function parseStreams(
  platform: Platform,
  value: unknown,
): FollowedReadOutcome<Stream> | null {
  if (!successBody(value) || !followedStreamsBodySchema.is(value.outcome.body)) {
    return null;
  }
  return completeRead(
    platform,
    value.outcome.body.streams,
    value.outcome.body.missing,
  );
}

export function parseChannels(
  platform: Platform,
  value: unknown,
): FollowedReadOutcome<Channel> | null {
  if (!successBody(value) || !followedChannelsBodySchema.is(value.outcome.body)) {
    return null;
  }
  return completeRead(
    platform,
    value.outcome.body.channels,
    value.outcome.body.missing,
  );
}

export function parseVideos(
  platform: Platform,
  channelId: string,
  value: unknown,
): FollowedRecordedOutcome<Video> | null {
  return parseRecorded(
    platform,
    channelId,
    value,
    followedVideosBodySchema.is,
    (body) => body.videos,
  );
}

export function parseClips(
  platform: Platform,
  channelId: string,
  value: unknown,
): FollowedRecordedOutcome<Clip> | null {
  return parseRecorded(
    platform,
    channelId,
    value,
    followedClipsBodySchema.is,
    (body) => body.clips,
  );
}

export function failedRead(
  platform: Platform,
  aborted = false,
): FollowedReadOutcome<never> {
  return {
    error: aborted ? "cancelled" : "relay-unavailable",
    items: [],
    missing: [],
    offline: false,
    platform,
    retryable: !aborted,
    stale: false,
    status: "failed",
  };
}

export function failedRecorded(
  platform: Platform,
  channelId: string,
): FollowedRecordedOutcome<never> {
  return {
    channelId,
    error: "relay-unavailable",
    failed: true,
    items: [],
    offline: false,
    platform,
    stale: false,
    supported: true,
  };
}

function parseRecorded<T, TBody extends { readonly supported: boolean }>(
  platform: Platform,
  channelId: string,
  value: unknown,
  isBody: (body: unknown) => body is TBody,
  itemsOf: (body: TBody) => readonly T[],
): FollowedRecordedOutcome<T> | null {
  if (!successBody(value) || !isBody(value.outcome.body)) return null;
  return {
    channelId,
    failed: false,
    items: itemsOf(value.outcome.body),
    offline: false,
    platform,
    stale: false,
    supported: value.outcome.body.supported,
  };
}

function successBody(
  value: unknown,
): value is {
  readonly outcome: { readonly kind: "success"; readonly body: unknown };
} {
  return (
    relayResponseEnvelopeSchema.is(value) && value.outcome.kind === "success"
  );
}

function completeRead<T>(
  platform: Platform,
  items: readonly T[],
  missing: readonly FollowedIdentityRef[],
): FollowedReadOutcome<T> {
  return {
    items,
    missing,
    offline: false,
    platform,
    retryable: false,
    stale: false,
    status: "complete",
  };
}
