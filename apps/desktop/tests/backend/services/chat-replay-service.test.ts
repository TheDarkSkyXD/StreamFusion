import { describe, expect, it, vi } from "vitest";
import { parseKickChatReplayPage } from "@/backend/api/platforms/kick/kick-chat-replay-source";
import { createChatReplayService } from "@/backend/services/chat-replay-service";
import backwardHistory from "../api/platforms/kick/fixtures/chat-replay-backward-pages.json";

// Guards: Chat Replay stays behind a replaceable Platform adapter instead of coupling UI to Twitch GQL
// Guards: Kick's observed start-time cursor sequence is traversed backward and returned chronologically
describe("Chat Replay service", () => {
  it("loads a normalized replay window through the Twitch capability adapter", async () => {
    const loadWindow = vi.fn().mockResolvedValue({
      capability: "supported",
      videoId: "video-1",
      messages: [
        {
          id: "message-1",
          offsetSeconds: 12,
          sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
          badges: [],
          fragments: [{ type: "text", text: "hello" }],
        },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    const service = createChatReplayService({ twitch: { loadWindow } });

    const result = await service.loadWindow({
      platform: "twitch",
      videoId: "video-1",
      offsetSeconds: 20,
    });

    expect(loadWindow).toHaveBeenCalledWith({
      videoId: "video-1",
      offsetSeconds: 0,
      signal: undefined,
    });
    expect(result).toMatchObject({
      capability: "supported",
      platform: "twitch",
      videoId: "video-1",
      messages: [{ id: "message-1", offsetSeconds: 12 }],
    });
  });

  it("paginates a dense VOD until the bounded time window is covered", async () => {
    const messages = Array.from({ length: 500 }, (_, index) => ({
      id: `message-${index}`,
      offsetSeconds: 180 + index / 2,
      sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
      badges: [],
      fragments: [{ type: "text" as const, text: `${index}` }],
    }));
    const loadWindow = vi.fn(async ({ cursor }: { cursor?: string }) => {
      const pageIndex = cursor ? Number(cursor.replace("page-", "")) : 0;
      const pageMessages = messages.slice(pageIndex * 100, pageIndex * 100 + 100);
      const hasNextPage = pageIndex < 4;
      return {
        capability: "supported" as const,
        videoId: "video-1",
        messages: pageMessages,
        nextCursor: hasNextPage ? `page-${pageIndex + 1}` : null,
        hasNextPage,
      };
    });
    const service = createChatReplayService({
      twitch: { loadWindow },
    });

    const result = await service.loadWindow({
      platform: "twitch",
      videoId: "video-1",
      offsetSeconds: 300,
    });

    expect(result.capability).toBe("supported");
    if (result.capability !== "supported") return;
    expect(loadWindow).toHaveBeenCalledTimes(5);
    expect(loadWindow).toHaveBeenNthCalledWith(2, {
      videoId: "video-1",
      cursor: "page-1",
      signal: undefined,
    });
    expect(result.messages).toHaveLength(481);
    expect(result.messages[0].offsetSeconds).toBe(180);
    expect(result.messages.at(-1)?.offsetSeconds).toBe(420);
  });

  it("forwards cancellation to every platform page request", async () => {
    const controller = new AbortController();
    const loadWindow = vi.fn().mockResolvedValue({
      capability: "empty",
      videoId: "video-1",
    });
    const service = createChatReplayService({ twitch: { loadWindow } });

    await service.loadWindow(
      { platform: "twitch", videoId: "video-1", offsetSeconds: 20 },
      controller.signal
    );

    expect(loadWindow).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });

  it("dispatches Kick replay through its adapter with the VOD locator", async () => {
    const loadWindow = vi.fn().mockResolvedValue({
      capability: "supported",
      videoId: "kick-video-1",
      messages: [],
      nextCursor: null,
      hasNextPage: false,
    });
    const service = createChatReplayService({
      twitch: { loadWindow: vi.fn() },
      kick: { loadWindow, paginationDirection: "backward" },
    });

    const result = await service.loadWindow({
      platform: "kick",
      videoId: "kick-video-1",
      offsetSeconds: 200,
      locator: { channelId: "668", startedAt: "2026-07-16T22:39:39Z" },
    });

    expect(loadWindow).toHaveBeenCalledWith({
      videoId: "kick-video-1",
      offsetSeconds: 320,
      locator: { channelId: "668", startedAt: "2026-07-16T22:39:39Z" },
      signal: undefined,
    });
    expect(result).toMatchObject({ capability: "supported", platform: "kick" });
  });

  it("follows Kick cursors backward from the upper bound and returns a chronological target window", async () => {
    const loadWindow = vi.fn(async ({ cursor }: { cursor?: string }) => {
      const pageIndex = cursor ? Number(cursor.replace("older-page-", "")) : 0;
      return parseKickChatReplayPage(
        backwardHistory.pages[pageIndex],
        "kick-video-1",
        backwardHistory.vodStartedAt
      );
    });
    const service = createChatReplayService({
      twitch: { loadWindow: vi.fn() },
      kick: { loadWindow, paginationDirection: "backward" },
    });

    const result = await service.loadWindow({
      platform: "kick",
      videoId: "kick-video-1",
      offsetSeconds: 300,
      locator: { channelId: "668", startedAt: backwardHistory.vodStartedAt },
    });

    expect(loadWindow).toHaveBeenCalledTimes(4);
    expect(loadWindow).toHaveBeenNthCalledWith(1, {
      videoId: "kick-video-1",
      offsetSeconds: 420,
      locator: { channelId: "668", startedAt: backwardHistory.vodStartedAt },
      signal: undefined,
    });
    expect(loadWindow).toHaveBeenNthCalledWith(2, {
      videoId: "kick-video-1",
      cursor: "older-page-1",
      locator: { channelId: "668", startedAt: backwardHistory.vodStartedAt },
      signal: undefined,
    });
    expect(result).toMatchObject({
      capability: "supported",
      messages: [
        { id: "at-190", offsetSeconds: 190 },
        { id: "at-250", offsetSeconds: 250 },
        { id: "at-300", offsetSeconds: 300 },
        { id: "at-400", offsetSeconds: 400 },
        { id: "at-410", offsetSeconds: 410 },
      ],
    });
  });

  it("finishes a Kick window at the VOD boundary instead of exhausting the safety limit", async () => {
    const loadWindow = vi
      .fn()
      .mockResolvedValueOnce({
        capability: "supported",
        videoId: "kick-video-1",
        messages: [],
        nextCursor: "older-page-1",
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        capability: "supported",
        videoId: "kick-video-1",
        messages: [
          {
            id: "at-100",
            offsetSeconds: 100,
            sender: { id: "42", login: "viewer", displayName: "Viewer" },
            badges: [],
            fragments: [{ type: "text", text: "in window" }],
          },
          {
            id: "at-vod-start",
            offsetSeconds: 0,
            sender: { id: "42", login: "viewer", displayName: "Viewer" },
            badges: [],
            fragments: [{ type: "text", text: "boundary" }],
          },
        ],
        nextCursor: "before-vod",
        hasNextPage: true,
      });
    const service = createChatReplayService({
      twitch: { loadWindow: vi.fn() },
      kick: { loadWindow, paginationDirection: "backward" },
    });

    const result = await service.loadWindow({
      platform: "kick",
      videoId: "kick-video-1",
      offsetSeconds: 60,
    });

    expect(loadWindow).toHaveBeenCalledTimes(2);
    expect(loadWindow).toHaveBeenNthCalledWith(1, {
      videoId: "kick-video-1",
      offsetSeconds: 180,
      signal: undefined,
    });
    expect(result).toMatchObject({
      capability: "supported",
      messages: [{ id: "at-vod-start" }, { id: "at-100" }],
    });
  });
});
