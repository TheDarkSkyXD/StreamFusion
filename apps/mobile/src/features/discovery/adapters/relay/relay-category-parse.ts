import {
  relayResponseEnvelopeSchema,
  signedOutCategoryBodySchema,
  signedOutCategoryClipsBodySchema,
  signedOutCategoryStreamsBodySchema,
  signedOutCategoryVideosBodySchema,
} from "@streamfusion/core/relay";
import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";

export function relayCategoryOutcome(
  platform: Platform,
  value: unknown,
): PlatformReadOutcome<Category> {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutCategoryBodySchema.is(value.outcome.body)
  ) {
    return relayFailed(platform);
  }
  return {
    cache: { kind: "miss" },
    items: [value.outcome.body.category],
    path: { kind: "relay", platform },
    platform,
    status: "complete",
  };
}

export function relayCategoryStreamsOutcome(
  platform: Platform,
  value: unknown,
): PlatformReadOutcome<Stream> {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutCategoryStreamsBodySchema.is(value.outcome.body)
  ) {
    return relayFailed(platform);
  }
  const body = value.outcome.body;
  return {
    cache: { kind: "miss" },
    items: body.streams,
    path: { kind: "relay", platform },
    platform,
    status: "complete",
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
  };
}

export function relayCategoryClipsOutcome(
  platform: Platform,
  value: unknown,
):
  | PlatformReadOutcome<Clip>
  | {
      readonly kind: "unsupported";
      readonly platform: Platform;
      readonly reason: "kick-clips-unsupported";
    } {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutCategoryClipsBodySchema.is(value.outcome.body)
  ) {
    return relayFailed(platform);
  }
  const body = value.outcome.body;
  if (body.kind === "unsupported") {
    return { kind: "unsupported", platform, reason: body.reason };
  }
  return {
    cache: { kind: "miss" },
    items: body.clips,
    path: { kind: "relay", platform },
    platform,
    status: "complete",
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
  };
}

export function relayCategoryVideosOutcome(
  platform: Platform,
  value: unknown,
):
  | PlatformReadOutcome<Video>
  | {
      readonly kind: "unsupported";
      readonly platform: Platform;
      readonly reason: "kick-videos-unsupported";
    } {
  if (
    !relayResponseEnvelopeSchema.is(value) ||
    value.outcome.kind !== "success" ||
    !signedOutCategoryVideosBodySchema.is(value.outcome.body)
  ) {
    return relayFailed(platform);
  }
  const body = value.outcome.body;
  if (body.kind === "unsupported") {
    return { kind: "unsupported", platform, reason: body.reason };
  }
  return {
    cache: { kind: "miss" },
    items: body.videos,
    path: { kind: "relay", platform },
    platform,
    status: "complete",
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
  };
}

export function relayFailed<T>(platform: Platform): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code: "relay-unavailable", retry: "manual" },
    items: [],
    path: { kind: "unavailable", platform, reason: "relay-unavailable" },
    platform,
    status: "failed",
  };
}

export function cancelled<T>(platform: Platform): PlatformReadOutcome<T> {
  return {
    cache: { kind: "miss" },
    error: { code: "cancelled", retry: "none" },
    items: [],
    path: { kind: "unavailable", platform, reason: "cancelled" },
    platform,
    status: "failed",
  };
}
