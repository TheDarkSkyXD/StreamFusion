import { describe, expect, it, vi } from "vitest";
import {
  createKickReplayJsonTransport,
  executeKickReplayBrowserRequest,
  fetchKickChatReplayPage,
  parseKickChatReplayPage,
} from "@/backend/api/platforms/kick/kick-chat-replay-source";
import observedPage from "./fixtures/chat-replay-page.json";

// Guards: Kick VOD history remains normalized to playback-relative timestamps with provider colors, badges, and emotes
// Guards: numeric browse-card ids are never sent to Kick's UUID-only VOD metadata endpoint.
// Guards: malformed archived rows do not discard the rest of a replay page
// Guards: cancelled seeks preserve AbortError and never open the BrowserWindow fallback
describe("Kick Chat Replay source contract", () => {
  it("normalizes an observed history page against the VOD start time", () => {
    const result = parseKickChatReplayPage(
      observedPage,
      "58084c74-3bc0-4f13-9cfd-259c15ab603a",
      "2026-07-16T22:39:39Z"
    );

    expect(result).toMatchObject({
      capability: "supported",
      videoId: "58084c74-3bc0-4f13-9cfd-259c15ab603a",
      nextCursor: "kick-cursor-002",
      hasNextPage: true,
      messages: [
        {
          id: "kick-message-001",
          offsetSeconds: 34,
          sender: {
            id: "42",
            login: "viewer-one",
            displayName: "ViewerOne",
            color: "#93EBE0",
          },
          badges: [
            {
              id: "subscriber:12-month-subscriber",
              setId: "subscriber",
              version: "12",
              imageUrl: "https://files.kick.com/badges/subscriber-12.png",
              title: "12 Month Subscriber",
            },
          ],
          fragments: [
            { type: "text", text: "hello " },
            {
              type: "emote",
              text: "xqcL",
              emoteId: "1082636",
              url: "https://files.kick.com/emotes/1082636/fullsize",
            },
            { type: "text", text: " world" },
          ],
        },
      ],
    });
  });

  it("requests history at the playback-relative wall-clock time", async () => {
    const requestJson = vi.fn().mockResolvedValue(observedPage);

    await fetchKickChatReplayPage(
      {
        videoId: "58084c74-3bc0-4f13-9cfd-259c15ab603a",
        offsetSeconds: 34,
        locator: { channelId: "668", startedAt: "2026-07-16T22:39:39Z" },
      },
      requestJson
    );

    expect(requestJson).toHaveBeenCalledWith(
      "https://web.kick.com/api/v1/chat/668/history?start_time=2026-07-16T22%3A40%3A13.000Z",
      undefined
    );
  });

  it("resolves a missing replay locator from Kick VOD metadata", async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce({
        start_time: "2026-07-16T22:39:39Z",
        livestream: { channel_id: 668 },
      })
      .mockResolvedValueOnce(observedPage);

    const result = await fetchKickChatReplayPage(
      {
        videoId: "12345",
        offsetSeconds: 34,
        locator: { videoUuid: "58084c74-3bc0-4f13-9cfd-259c15ab603a" },
      },
      requestJson
    );

    expect(requestJson.mock.calls.map(([url]) => url)).toEqual([
      "https://kick.com/api/v1/video/58084c74-3bc0-4f13-9cfd-259c15ab603a",
      "https://web.kick.com/api/v1/chat/668/history?start_time=2026-07-16T22%3A40%3A13.000Z",
    ]);
    expect(result).toMatchObject({ capability: "supported", messages: [{ offsetSeconds: 34 }] });
  });

  it("does not treat a numeric Kick VOD card id as a metadata UUID", async () => {
    const requestJson = vi.fn();

    await expect(
      fetchKickChatReplayPage({ videoId: "117758226", offsetSeconds: 34 }, requestJson)
    ).resolves.toEqual({
      capability: "unsupported",
      videoId: "117758226",
      reason: "vod-locator-unavailable",
    });
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("falls back to the persistent browser session when a direct request is blocked", async () => {
    const directRequest = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      body: '{"error":"Request blocked by security policy."}',
    });
    const browserRequest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(observedPage),
    });
    const requestJson = createKickReplayJsonTransport({ directRequest, browserRequest });

    await expect(requestJson("https://web.kick.com/api/v1/chat/668/history")).resolves.toEqual(
      observedPage
    );
    expect(browserRequest).toHaveBeenCalledWith(
      "https://web.kick.com/api/v1/chat/668/history",
      undefined
    );
  });

  it("keeps an empty cursor-bearing page pageable", () => {
    expect(
      parseKickChatReplayPage(
        { data: { messages: [], cursor: "kick-cursor-001", pinned_message: null }, message: "OK" },
        "58084c74-3bc0-4f13-9cfd-259c15ab603a",
        "2026-07-16T22:39:39Z"
      )
    ).toEqual({
      capability: "supported",
      videoId: "58084c74-3bc0-4f13-9cfd-259c15ab603a",
      messages: [],
      nextCursor: "kick-cursor-001",
      hasNextPage: true,
    });
  });

  it("skips malformed archived rows without discarding valid messages in the page", () => {
    const result = parseKickChatReplayPage(
      {
        data: {
          messages: [
            observedPage.data.messages[0],
            { id: "missing-sender", content: "incomplete", created_at: "2026-07-16T22:40:14Z" },
            {
              id: "bad-date",
              user_id: 43,
              content: "incomplete",
              sender: { id: 43, slug: "viewer-two", username: "ViewerTwo" },
              created_at: "not-a-date",
            },
          ],
          cursor: null,
        },
      },
      "58084c74-3bc0-4f13-9cfd-259c15ab603a",
      "2026-07-16T22:39:39Z"
    );

    expect(result).toMatchObject({
      capability: "supported",
      messages: [{ id: "kick-message-001" }],
    });
  });

  it("preserves AbortError instead of starting the browser fallback", async () => {
    const abortError = new DOMException("seek replaced", "AbortError");
    const directRequest = vi.fn().mockRejectedValue(abortError);
    const browserRequest = vi.fn();
    const requestJson = createKickReplayJsonTransport({ directRequest, browserRequest });

    await expect(requestJson("https://web.kick.com/api/v1/chat/668/history")).rejects.toBe(
      abortError
    );
    expect(browserRequest).not.toHaveBeenCalled();
  });

  it("does not queue a BrowserWindow fallback when the seek is already cancelled", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("seek replaced", "AbortError");
    controller.abort(abortError);
    const acquireSlot = vi.fn();

    await expect(
      executeKickReplayBrowserRequest(
        "https://web.kick.com/api/v1/chat/668/history",
        controller.signal,
        {
          acquireSlot,
          createWindow: vi.fn(),
        }
      )
    ).rejects.toBe(abortError);
    expect(acquireSlot).not.toHaveBeenCalled();
  });

  it("releases an acquired queue slot when cancellation wins while waiting", async () => {
    const controller = new AbortController();
    const releaseSlot = vi.fn();
    let grantSlot: ((release: () => void) => void) | undefined;
    const acquireSlot = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          grantSlot = resolve;
        })
    );
    const request = executeKickReplayBrowserRequest(
      "https://web.kick.com/api/v1/chat/668/history",
      controller.signal,
      { acquireSlot, createWindow: vi.fn() }
    );

    controller.abort(new DOMException("seek replaced", "AbortError"));
    grantSlot?.(releaseSlot);

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(releaseSlot).toHaveBeenCalledOnce();
  });
});
