import { describe, expect, it, vi } from "vitest";

import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import type { FocusedWatchSession, WatchTarget } from "../capabilities/watch";
import { startWatchThenResume } from "../components/start-watch-session";

const recorded: WatchTarget = {
  platform: "twitch",
  channelId: "channel-1",
  channelName: "streamer",
  media: {
    kind: "video",
    id: "video-1",
    title: "Recorded stream",
    durationSeconds: 600,
    resumePositionSeconds: 12,
  },
};

describe("saved Watch playback", () => {
  it("seeks to current matching History progress after starting a saved recording", async () => {
    const start = vi.fn(async () => ({
      kind: "started" as const,
      session: {},
    }));
    const seekTo = vi.fn(async () => undefined);
    const leave = vi.fn(async () => undefined);
    const session = { start, seekTo, leave } as unknown as FocusedWatchSession;
    const history = {
      list: vi.fn(async () => [
        {
          id: "twitch-video-video-1",
          platform: "twitch",
          kind: "video",
          contentId: "video-1",
          channelId: "channel-1",
          channelLogin: "streamer",
          channelDisplayName: "Streamer",
          avatarUrl: "",
          durationSeconds: 600,
          positionSeconds: 90,
          thumbnailUrl: "",
          title: "Recorded stream",
          updatedAt: 1,
        },
      ]),
    } as unknown as WatchHistoryRepository;
    await startWatchThenResume({
      session,
      target: recorded,
      history,
      signal: new AbortController().signal,
    });
    expect(start).toHaveBeenCalledOnce();
    expect(seekTo).toHaveBeenCalledExactlyOnceWith(90_000);
    expect(leave).not.toHaveBeenCalled();
  });

  it("leaves only the saved target when navigation cancels a pending start", async () => {
    let finishStart: (result: {
      readonly kind: "started";
      readonly session: object;
    }) => void = () => undefined;
    const start = vi.fn(
      () =>
        new Promise<{ readonly kind: "started"; readonly session: object }>(
          (resolve) => {
            finishStart = resolve;
          },
        ),
    );
    const leave = vi.fn(async () => undefined);
    const seekTo = vi.fn(async () => undefined);
    const session = { start, leave, seekTo } as unknown as FocusedWatchSession;
    const cancelled = new AbortController();
    const pending = startWatchThenResume({
      session,
      target: recorded,
      signal: cancelled.signal,
    });
    expect(start).toHaveBeenCalledExactlyOnceWith(recorded);
    cancelled.abort();
    finishStart({ kind: "started", session: { sessionId: "saved:1" } });
    await pending;
    expect(leave).toHaveBeenCalledExactlyOnceWith(recorded);
    expect(seekTo).not.toHaveBeenCalled();
  });

  it("does not start a stale saved target after navigation cancels a pending History read", async () => {
    let resolveHistory: (items: []) => void = () => undefined;
    const history = {
      list: () =>
        new Promise<[]>((resolve) => {
          resolveHistory = resolve;
        }),
    } as unknown as WatchHistoryRepository;
    const start = vi.fn(async () => ({
      kind: "started" as const,
      session: {},
    }));
    const session = {
      start,
      seekTo: vi.fn(async () => undefined),
    } as unknown as FocusedWatchSession;
    const cancelled = new AbortController();
    const pending = startWatchThenResume({
      session,
      target: recorded,
      history,
      signal: cancelled.signal,
    });
    cancelled.abort();
    resolveHistory([]);
    await pending;
    const chosen: WatchTarget = { ...recorded, channelName: "chosen-streamer" };
    await startWatchThenResume({ session, target: chosen });
    expect(start).toHaveBeenCalledExactlyOnceWith(chosen);
  });
});
