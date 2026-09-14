import type {
  ChannelPageOutcome,
  DiscoverySession,
  PlatformReadOutcome,
} from "@mobile/features/discovery/capabilities/platform-reads";
import type { Stream } from "@streamfusion/core/content";

import type {
  WatchContextFailure,
  WatchInfo,
  WatchInspection,
  WatchInspectionReader,
  WatchRelated,
  WatchTarget,
} from "../capabilities/watch";

export function createDiscoveryWatchInspectionReader(
  session: DiscoverySession,
): WatchInspectionReader {
  return {
    async read({ signal, target }): Promise<WatchInspection> {
      const page = await session.readChannel({
        channel: {
          id: target.channelId,
          platform: target.platform,
          username: target.channelName,
        },
        signal,
      });
      const info = infoFrom(page, target);
      return {
        info,
        related: await relatedFrom(session, signal, target, page),
        target,
      };
    },
  };
}

function infoFrom(page: ChannelPageOutcome, target: WatchTarget): WatchInfo {
  if (page.channel && target.media) {
    return {
      channel: page.channel,
      durationSeconds: target.media.durationSeconds,
      kind: "recorded",
      mediaKind: target.media.kind,
      title: target.media.title,
    };
  }
  if (page.channel && page.live && page.live.isLive) {
    return { channel: page.channel, kind: "live", stream: page.live };
  }
  if (page.channel) {
    return { channel: page.channel, kind: "ended" };
  }
  return { failure: failureFrom(page), kind: "unavailable" };
}

async function relatedFrom(
  session: DiscoverySession,
  signal: AbortSignal,
  target: WatchTarget,
  page: ChannelPageOutcome,
): Promise<WatchRelated> {
  const categoryId = page.live?.categoryId ?? page.channel?.categoryId;
  if (!categoryId) return { kind: "empty" };
  const outcome = await session.readCategoryStreams({
    categoryId,
    platform: target.platform,
    signal,
  });
  if (outcome.path.kind === "unavailable" && outcome.path.reason === "cancelled") {
    return { failure: { kind: "cancelled" }, kind: "unavailable" };
  }
  if (outcome.status === "failed") {
    return { failure: failureFromOutcome(outcome), kind: "unavailable" };
  }
  const items = outcome.items.filter(
    (stream) =>
      stream.channelId !== target.channelId &&
      stream.channelName.toLowerCase() !== target.channelName.toLowerCase(),
  );
  return items.length === 0 ? { kind: "empty" } : { items, kind: "ready" };
}

function failureFrom(page: ChannelPageOutcome): WatchContextFailure {
  if (page.path.kind === "unavailable" && page.path.reason === "cancelled") {
    return { kind: "cancelled" };
  }
  if (page.path.kind === "unavailable" && page.path.reason === "offline") {
    return {
      detail: "Channel details are unavailable while offline.",
      kind: "offline",
      retry: "manual",
    };
  }
  return {
    detail: "Channel details are unavailable.",
    kind: "provider-unavailable",
    retry: "manual",
  };
}

function failureFromOutcome(
  outcome: PlatformReadOutcome<Stream>,
): WatchContextFailure {
  if (outcome.path.kind === "unavailable" && outcome.path.reason === "offline") {
    return {
      detail: "Related streams are unavailable while offline.",
      kind: "offline",
      retry: "manual",
    };
  }
  return {
    detail: "Related streams are unavailable.",
    kind: "provider-unavailable",
    retry: "manual",
  };
}
