import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearChatReplayWindowCache, useChatReplay } from "@/hooks/use-chat-replay";
import { useChatStore } from "@/store/chat-store";
import { installElectronAPIMock } from "../test-utils";

// Guards: historical replay remains session-local and never enters live channelKey chat buckets
describe("useChatReplay", () => {
  beforeEach(() => {
    clearChatReplayWindowCache();
    useChatStore.setState({ messagesByChannel: {} });
  });

  it("loads replay without writing messages into the live chat store", async () => {
    const api = installElectronAPIMock();
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: {
        capability: "supported",
        platform: "twitch",
        videoId: "video-1",
        messages: [
          {
            id: "replay-message-1",
            offsetSeconds: 12,
            sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
            badges: [],
            fragments: [{ type: "text", text: "historical" }],
          },
        ],
        nextCursor: null,
        hasNextPage: false,
      },
    });

    const { result } = renderHook(() =>
      useChatReplay({
        platform: "twitch",
        videoId: "video-1",
        playback: { currentTime: 20, isPlaying: true, playbackRate: 1 },
      })
    );

    await waitFor(() => expect(result.current.result?.capability).toBe("supported"));
    expect(useChatStore.getState().messagesByChannel).toEqual({});
  });

  it("requests replay windows for Kick VODs", async () => {
    const api = installElectronAPIMock();
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: { capability: "empty", platform: "kick", videoId: "video-1" },
    });

    const { result } = renderHook(() =>
      useChatReplay({
        platform: "kick",
        videoId: "video-1",
        playback: { currentTime: 20, isPlaying: true, playbackRate: 1 },
      })
    );

    await waitFor(() => expect(result.current.result?.capability).toBe("empty"));
    expect(api.videos.getChatReplayWindow).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "kick", videoId: "video-1", offsetSeconds: 0 })
    );
  });

  it("forwards a Kick replay locator to the replay source", async () => {
    const api = installElectronAPIMock();
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: { capability: "empty", platform: "kick", videoId: "video-1" },
    });
    const locator = {
      channelId: "channel-42",
      startedAt: "2026-07-17T12:30:00.000Z",
      videoUuid: "vod-uuid",
    };

    renderHook(() =>
      useChatReplay({
        platform: "kick",
        videoId: "video-1",
        playback: { currentTime: 20, isPlaying: false, playbackRate: 1 },
        locator,
      })
    );

    await waitFor(() => expect(api.videos.getChatReplayWindow).toHaveBeenCalled());
    expect(api.videos.getChatReplayWindow).toHaveBeenCalledWith(
      expect.objectContaining({ locator })
    );
  });

  it("isolates cached replay windows by platform and video", async () => {
    const api = installElectronAPIMock();
    api.videos.getChatReplayWindow = vi.fn(async (request) => ({
      success: true,
      data: { capability: "empty", platform: request.platform, videoId: request.videoId },
    }));

    const { result } = renderHook(() => ({
      twitch: useChatReplay({
        platform: "twitch",
        videoId: "shared-id",
        playback: { currentTime: 20, isPlaying: false, playbackRate: 1 },
      }),
      kick: useChatReplay({
        platform: "kick",
        videoId: "shared-id",
        playback: { currentTime: 20, isPlaying: false, playbackRate: 1 },
      }),
    }));

    await waitFor(() => {
      expect(result.current.twitch.result?.platform).toBe("twitch");
      expect(result.current.kick.result?.platform).toBe("kick");
    });
    expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(2);
  });

  it("deduplicates an in-flight window and cancels it after the last subscriber leaves", () => {
    const api = installElectronAPIMock();
    api.videos.getChatReplayWindow = vi.fn(() => new Promise(() => undefined));
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: true });

    const { unmount } = renderHook(() => {
      useChatReplay({
        platform: "twitch",
        videoId: "video-dedup",
        playback: { currentTime: 20, isPlaying: true, playbackRate: 1 },
      });
      useChatReplay({
        platform: "twitch",
        videoId: "video-dedup",
        playback: { currentTime: 20, isPlaying: true, playbackRate: 1 },
      });
    });

    expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(1);
    unmount();
    expect(api.videos.cancelChatReplayWindow).toHaveBeenCalledTimes(1);
  });

  it("reuses recent seek windows and evicts the oldest window from the bounded cache", async () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn(async (request) => ({
      success: true,
      data: { capability: "empty", platform: "twitch", videoId: request.videoId },
    }));
    const { rerender } = renderHook(
      ({ currentTime }) =>
        useChatReplay({
          platform: "twitch",
          videoId: "video-cache",
          playback: { currentTime, isPlaying: false, playbackRate: 1 },
        }),
      { initialProps: { currentTime: 20 } }
    );
    await waitFor(() => expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(1));

    rerender({ currentTime: 130 });
    await waitFor(() => expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(2));
    rerender({ currentTime: 20 });
    await waitFor(() => expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(2));

    for (let bucket = 2; bucket <= 9; bucket += 1) {
      rerender({ currentTime: bucket * 120 + 1 });
      await waitFor(() => expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(bucket + 1));
    }
    rerender({ currentTime: 20 });
    await waitFor(() => expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(11));
  });
});
