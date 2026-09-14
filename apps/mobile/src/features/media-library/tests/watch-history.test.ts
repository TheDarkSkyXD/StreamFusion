import { describe, expect, it } from "vitest";

import type { WatchHistoryItem } from "../capabilities/watch-history";
import { MAX_WATCH_HISTORY_ITEMS } from "../capabilities/watch-history";
import {
  canResumeWatchHistory,
  filterWatchHistory,
  shouldPersistWatchProgress,
  upsertWatchHistory,
  watchHistoryItemFromCapture,
  watchHistoryItemId,
  watchTargetFromHistory,
} from "../domain/watch-history";
import { composeWatchHistoryView } from "../domain/watch-history-view";

// Guards: typed History identity stays Stream, Video, or Clip and resume never autoplays
// Guards: local search and the 200-item cap apply without a network read
// Guards: restored recorded media keeps saved position only after an explicit Resume

const streamItem: WatchHistoryItem = {
  avatarUrl: "https://example.test/avatar.png",
  channelDisplayName: "xQc",
  channelId: "71092938",
  channelLogin: "xqc",
  contentId: "71092938",
  durationSeconds: 0,
  id: "twitch-stream-71092938",
  kind: "stream",
  platform: "twitch",
  positionSeconds: 0,
  thumbnailUrl: "https://example.test/live.png",
  title: "Live now",
  updatedAt: 1,
};

const videoItem: WatchHistoryItem = {
  ...streamItem,
  contentId: "vod-1",
  durationSeconds: 120,
  id: "twitch-video-vod-1",
  kind: "video",
  positionSeconds: 40,
  thumbnailUrl: "https://example.test/vod.png",
  title: "Yesterday",
  updatedAt: 2,
};

describe("watch history", () => {
  it("keeps Stream, Video, and Clip identity on a stable id", () => {
    expect(
      watchHistoryItemId({
        contentId: "clip-1",
        kind: "clip",
        platform: "kick",
      }),
    ).toBe("kick-clip-clip-1");
  });

  it("bumps an existing item and caps the list at 200", () => {
    const filled = Array.from({ length: MAX_WATCH_HISTORY_ITEMS }, (_, index) => ({
      ...streamItem,
      contentId: `channel-${index}`,
      id: `twitch-stream-channel-${index}`,
      updatedAt: index,
    }));
    const next = upsertWatchHistory(filled, {
      ...videoItem,
      updatedAt: 999,
    });
    expect(next[0]?.id).toBe(videoItem.id);
    expect(next).toHaveLength(MAX_WATCH_HISTORY_ITEMS);
    expect(next.some((item) => item.id === "twitch-stream-channel-0")).toBe(
      false,
    );
  });

  it("filters locally by title and channel without dropping other types", () => {
    const items = [
      streamItem,
      videoItem,
      { ...videoItem, id: "kick-clip-1", kind: "clip" as const, platform: "kick" as const, title: "Clip", contentId: "1", channelDisplayName: "Other", channelLogin: "other" },
    ];
    expect(filterWatchHistory(items, "yesterday")).toEqual([videoItem]);
    expect(filterWatchHistory(items, "XQC")).toHaveLength(2);
  });

  it("resumes recorded media at the saved position and replays from the start", () => {
    expect(canResumeWatchHistory(streamItem)).toBe(false);
    expect(canResumeWatchHistory(videoItem)).toBe(true);
    expect(watchTargetFromHistory(videoItem, "resume").media).toMatchObject({
      id: "vod-1",
      kind: "video",
      resumePositionSeconds: 40,
    });
    expect(watchTargetFromHistory(videoItem, "replay").media).toEqual({
      durationSeconds: 120,
      id: "vod-1",
      kind: "video",
      thumbnailUrl: "https://example.test/vod.png",
      title: "Yesterday",
    });
    expect(watchTargetFromHistory(streamItem, "open").media).toBeUndefined();
  });

  it("captures a live Watch target as a Stream row", () => {
    const item = watchHistoryItemFromCapture({
      inspection: {
        info: {
          channel: {
            avatarUrl: "https://example.test/avatar.png",
            displayName: "xQc",
            id: "71092938",
            isLive: true,
            isPartner: false,
            isVerified: false,
            platform: "twitch",
            username: "xqc",
          },
          kind: "live",
          stream: {
            channelAvatar: "https://example.test/avatar.png",
            channelDisplayName: "xQc",
            channelId: "71092938",
            channelName: "xqc",
            id: "stream-1",
            isLive: true,
            language: "en",
            platform: "twitch",
            startedAt: null,
            tags: [],
            thumbnailUrl: "https://example.test/live.png",
            title: "Live now",
            viewerCount: 1,
          },
        },
        related: { kind: "empty" },
        target: {
          channelId: "71092938",
          channelName: "xqc",
          platform: "twitch",
        },
      },
      positionSeconds: 0,
      target: {
        channelId: "71092938",
        channelName: "xqc",
        platform: "twitch",
      },
      updatedAt: 10,
    });
    expect(item).toMatchObject({
      kind: "stream",
      id: "twitch-stream-71092938",
      thumbnailUrl: "https://example.test/live.png",
      title: "Live now",
    });
  });

  it("throttles progress writes and keeps offline History readable", () => {
    expect(
      shouldPersistWatchProgress({ next: 4, previous: 0 }),
    ).toBe(false);
    expect(
      shouldPersistWatchProgress({ next: 5, previous: 0 }),
    ).toBe(true);
    const view = composeWatchHistoryView({
      items: [streamItem, videoItem],
      offline: true,
      query: "yesterday",
    });
    expect(view.status).toBe("offline");
    expect(view.items).toEqual([videoItem]);
  });
});
