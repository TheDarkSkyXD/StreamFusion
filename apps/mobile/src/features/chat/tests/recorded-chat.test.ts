import { describe, expect, it, vi } from "vitest";
import { createRecordedChatReader } from "../adapters/recorded-chat-reader";
import { createRecordedChatSession } from "../domain/recorded-chat-session";
import type { ChatReplayReader } from "../capabilities/watch-chat";
import { getBundledBadgeUrl } from "../utils/kick-badge-assets";

const twitch = {
  channelId: "1",
  channelName: "channel",
  platform: "twitch",
  media: { id: "123", kind: "video" },
} as const;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const message = (id: string, offsetSeconds: number) => ({
  id,
  displayName: "Viewer",
  username: "viewer",
  text: id,
  offsetSeconds,
  badges: [],
});
const node = (id: string, seconds: number) => ({
  cursor: `cursor-${id}`,
  node: {
    id,
    contentOffsetSeconds: seconds,
    commenter: { id: "2", login: "viewer", displayName: "Viewer" },
    message: {
      fragments: [{ text: "Kappa", emote: { emoteID: "25" } }],
      userBadges: [],
    },
  },
});

describe("recorded providers", () => {
  it("sends Twitch offset or cursor queries and parses recorded native fragments", async () => {
    const fetch = vi.fn(async () =>
      json([
        {
          data: {
            video: {
              id: "123",
              comments: {
                edges: [node("a", 60)],
                pageInfo: { hasNextPage: true },
              },
            },
          },
        },
      ]),
    );
    const reader = createRecordedChatReader(fetch);
    const signal = new AbortController().signal;
    expect(await reader.read(twitch, 60, null, signal)).toMatchObject({
      kind: "page",
      cursor: "cursor-a",
      messages: [
        {
          id: "a",
          offsetSeconds: 60,
          userId: "2",
          parts: [
            {
              kind: "emote",
              text: "Kappa",
              imageUrl:
                "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
            },
          ],
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://gql.twitch.tv/gql",
      expect.objectContaining({
        signal,
        method: "POST",
        headers: {
          "Client-Id": "kd1unb4b3q4t58fwlpcbzcbnm76a8fp",
          "Content-Type": "application/json",
        },
      }),
    );
    const firstBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(firstBody[0].variables).toEqual({
      videoID: "123",
      contentOffsetSeconds: 60,
    });
    await reader.read(twitch, 60, "next", signal);
    const secondBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(secondBody[0].variables).toEqual({ videoID: "123", cursor: "next" });
  });
  it("does not call a live guest endpoint for recorded Kick history", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({ channel_id: 11, start_time: "2026-10-05T10:00:00Z" }),
      )
      .mockResolvedValueOnce(
        json({
          data: {
            cursor: "next-kick",
            messages: [
              {
                id: "k1",
                content: "hello",
                created_at: "2026-10-05T10:01:00Z",
                sender: {
                  id: 2,
                  slug: "viewer",
                  username: "Viewer",
                  identity: {
                    badges: [
                      { type: "moderator", text: "Moderator" },
                      { type: "subscriber", count: 14 },
                    ],
                  },
                },
              },
              {
                id: "k2",
                content: "hello again",
                created_at: "2026-10-05T10:01:01Z",
                sender: {
                  id: 3,
                  slug: "gifter",
                  username: "Gifter",
                  badges: [{ type: "sub_gifter", count: 50 }],
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(json({ data: { cursor: null, messages: [] } }));
    const reader = createRecordedChatReader(fetch);
    const target = {
      ...twitch,
      platform: "kick",
      media: { id: "12345678-1234-1234-1234-123456789abc", kind: "video" },
    } as const;
    expect(
      await reader.read(target, 60, null, new AbortController().signal),
    ).toMatchObject({
      kind: "page",
      cursor: "next-kick",
      messages: [
        {
          id: "k1",
          offsetSeconds: 60,
          badges: [
            { setId: "moderator", imageUrl: getBundledBadgeUrl("moderator") },
            {
              setId: "subscriber",
              version: "14",
              imageUrl: getBundledBadgeUrl("subscriber"),
            },
          ],
        },
        {
          id: "k2",
          badges: [
            {
              setId: "sub_gifter",
              version: "50",
              imageUrl: getBundledBadgeUrl("sub_gifter", 50),
            },
          ],
        },
      ],
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://web.kick.com/api/v1/chat/11/history?start_time=2026-10-05T10%3A01%3A00.000Z",
    );
    expect(
      await reader.read(target, 60, "next-kick", new AbortController().signal),
    ).toEqual({ kind: "page", cursor: null, messages: [] });
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "https://web.kick.com/api/v1/chat/11/history?cursor=next-kick",
    );
  });
  it("distinguishes genuine empty pages from missing or malformed provider data", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json([
          {
            data: {
              video: {
                id: "123",
                comments: { edges: [], pageInfo: { hasNextPage: false } },
              },
            },
          },
        ]),
      )
      .mockResolvedValueOnce(json([{ errors: [{ message: "rate limited" }] }]))
      .mockResolvedValueOnce(json([{ data: { video: null } }]));
    const reader = createRecordedChatReader(fetch);
    expect(
      await reader.read(twitch, 0, null, new AbortController().signal),
    ).toEqual({ kind: "page", cursor: null, messages: [] });
    await expect(
      reader.read(twitch, 0, null, new AbortController().signal),
    ).rejects.toThrow("invalid page");
    expect(
      await reader.read(twitch, 0, null, new AbortController().signal),
    ).toEqual({
      kind: "unavailable",
      detail: "This video is no longer available.",
    });
  });
});

describe("recorded playback synchronization", () => {
  it("paginates without displaying messages ahead of playback and advances while playing", async () => {
    const read = vi
      .fn<ChatReplayReader["read"]>()
      .mockResolvedValueOnce({
        kind: "page",
        messages: [message("a", 1)],
        cursor: "page2",
      })
      .mockResolvedValueOnce({
        kind: "page",
        messages: [message("b", 30)],
        cursor: null,
      });
    const session = createRecordedChatSession({ read });
    session.attach(twitch);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(session.snapshot()).toEqual({
      kind: "empty",
      detail: "No recorded comments at this playback position.",
    });
    session.syncPlayback?.(2000);
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [{ id: "a" }],
    });
    for (const position of [10000, 18000, 26000, 30000])
      session.syncPlayback?.(position);
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [{ id: "a" }, { id: "b" }],
    });
    expect(read.mock.calls[1]?.[2]).toBe("page2");
    session.dispose();
  });
  it("aborts stale pages on a seek and starts at the new playback window", async () => {
    let resolveFirst:
      | ((value: Awaited<ReturnType<ChatReplayReader["read"]>>) => void)
      | undefined;
    const read = vi
      .fn<ChatReplayReader["read"]>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolveFirst = done;
          }),
      )
      .mockResolvedValueOnce({
        kind: "page",
        messages: [message("after-seek", 120)],
        cursor: null,
      });
    const session = createRecordedChatSession({ read });
    session.attach(twitch);
    session.syncPlayback?.(120000);
    expect(read.mock.calls[0]?.[3].aborted).toBe(true);
    resolveFirst?.({
      kind: "page",
      messages: [message("stale", 1)],
      cursor: "obsolete",
    });
    await vi.waitFor(() =>
      expect(session.snapshot()).toMatchObject({
        kind: "live",
        messages: [{ id: "after-seek" }],
      }),
    );
    expect(read.mock.calls[1]?.[1]).toBe(90);
    expect(read.mock.calls[1]?.[2]).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it("surfaces a replay failure and rejects repeated cursors instead of looping", async () => {
    const read = vi
      .fn<ChatReplayReader["read"]>()
      .mockResolvedValue({ kind: "page", messages: [], cursor: "loop" });
    const session = createRecordedChatSession({ read });
    session.attach(twitch);
    await vi.waitFor(() =>
      expect(session.snapshot()).toEqual({
        kind: "failed",
        retry: "manual",
        detail: "Recorded comments repeated a cursor.",
      }),
    );
    expect(read).toHaveBeenCalledTimes(2);
    session.dispose();
  });
});
