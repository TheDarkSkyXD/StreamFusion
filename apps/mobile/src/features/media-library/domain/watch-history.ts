import type { Platform } from "@streamfusion/core/platform";

import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import {
  MAX_WATCH_HISTORY_ITEMS,
  type WatchHistoryCapture,
  type WatchHistoryItem,
  type WatchHistoryKind,
  type WatchHistoryOpenMode,
} from "../capabilities/watch-history";

export const WATCH_HISTORY_PROGRESS_STEP_SECONDS = 5;

export function watchHistoryItemId(input: {
  readonly contentId: string;
  readonly kind: WatchHistoryKind;
  readonly platform: Platform;
}): string {
  return `${input.platform}-${input.kind}-${input.contentId}`;
}

export function upsertWatchHistory(
  items: readonly WatchHistoryItem[],
  next: WatchHistoryItem,
): readonly WatchHistoryItem[] {
  return [next, ...items.filter((item) => item.id !== next.id)]
    .toSorted((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, MAX_WATCH_HISTORY_ITEMS);
}

export function filterWatchHistory(
  items: readonly WatchHistoryItem[],
  query: string,
): readonly WatchHistoryItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(needle) ||
      item.channelLogin.toLowerCase().includes(needle) ||
      item.channelDisplayName.toLowerCase().includes(needle),
  );
}

export function canResumeWatchHistory(item: WatchHistoryItem): boolean {
  return (
    item.kind !== "stream" &&
    item.positionSeconds > 0 &&
    (item.durationSeconds === 0 || item.positionSeconds < item.durationSeconds)
  );
}

export function watchHistoryProgressRatio(
  item: WatchHistoryItem,
): number | null {
  if (item.kind === "stream" || item.durationSeconds <= 0) return null;
  return Math.min(1, item.positionSeconds / item.durationSeconds);
}

export function shouldPersistWatchProgress(input: {
  readonly previous: number;
  readonly next: number;
}): boolean {
  return (
    input.next >= 0 &&
    Math.abs(input.next - input.previous) >= WATCH_HISTORY_PROGRESS_STEP_SECONDS
  );
}

export function watchTargetFromHistory(
  item: WatchHistoryItem,
  mode: WatchHistoryOpenMode,
): WatchTarget {
  const live = {
    channelId: item.channelId,
    channelName: item.channelLogin,
    platform: item.platform,
  };
  if (item.kind === "stream" || mode === "open") return live;
  return {
    ...live,
    media: {
      durationSeconds: item.durationSeconds,
      id: item.contentId,
      kind: item.kind,
      title: item.title,
      ...(item.thumbnailUrl.length > 0
        ? { thumbnailUrl: item.thumbnailUrl }
        : {}),
      ...(mode === "resume" && canResumeWatchHistory(item)
        ? { resumePositionSeconds: item.positionSeconds }
        : {}),
    },
  };
}

export function watchHistoryItemFromCapture(
  capture: WatchHistoryCapture,
): WatchHistoryItem | null {
  const kind: WatchHistoryKind = capture.target.media?.kind ?? "stream";
  const contentId = capture.target.media?.id ?? capture.target.channelId;
  if (contentId.length === 0) return null;
  return {
    ...captureDisplayFields(capture),
    contentId,
    durationSeconds: Math.max(
      0,
      Math.floor(capture.target.media?.durationSeconds ?? 0),
    ),
    id: watchHistoryItemId({
      contentId,
      kind,
      platform: capture.target.platform,
    }),
    kind,
    platform: capture.target.platform,
    positionSeconds: Math.max(0, Math.floor(capture.positionSeconds)),
    updatedAt: capture.updatedAt,
  };
}

function captureDisplayFields(capture: WatchHistoryCapture): {
  readonly avatarUrl: string;
  readonly channelDisplayName: string;
  readonly channelId: string;
  readonly channelLogin: string;
  readonly thumbnailUrl: string;
  readonly title: string;
} {
  const { inspection, target } = capture;
  const info = inspection?.info;
  const channel = info && info.kind !== "unavailable" ? info.channel : null;
  const stream = info?.kind === "live" ? info.stream : null;
  return {
    avatarUrl: channel?.avatarUrl ?? "",
    channelDisplayName:
      channel?.displayName ?? stream?.channelDisplayName ?? target.channelName,
    channelId: target.channelId,
    channelLogin: target.channelName,
    thumbnailUrl: target.media?.thumbnailUrl ?? stream?.thumbnailUrl ?? "",
    title:
      target.media?.title ??
      stream?.title ??
      channel?.lastStreamTitle ??
      channel?.displayName ??
      target.channelName,
  };
}
