import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTwitchChatReplayPage,
  parseTwitchChatReplayPage,
  TwitchChatReplaySourceError,
} from "@/backend/api/platforms/twitch/twitch-chat-replay-source";
import emptyPage from "./fixtures/chat-replay-empty.json";
import observedPage from "./fixtures/chat-replay-page.json";
import transientError from "./fixtures/chat-replay-transient-error.json";
import unsupportedPage from "./fixtures/chat-replay-unsupported.json";

afterEach(() => vi.unstubAllGlobals());

// Guards: a Twitch replay page remains addressable by Video and playback offset when the web schema changes
// Guards: cursor pagination preserves stable IDs, sender presentation, badges, and ordered content fragments
// Guards: empty, unsupported, and transient source responses remain distinct capability outcomes
// Guards: first-party replay requests remain anonymous and classify authentication, rate-limit, and transient HTTP failures
describe("Twitch Chat Replay source contract", () => {
  it("returns historical messages for a Video at playback offsets", () => {
    const result = parseTwitchChatReplayPage(observedPage, "video-redacted-001");

    expect(result).toMatchObject({
      capability: "supported",
      videoId: "video-redacted-001",
      messages: [{ id: "message-redacted-001", offsetSeconds: 16 }],
    });
  });

  it("preserves the observed cursor, sender presentation, badges, and content fragments", () => {
    const result = parseTwitchChatReplayPage(observedPage, "video-redacted-001");

    expect(result).toMatchObject({
      nextCursor: "cursor-redacted-001",
      hasNextPage: true,
      messages: [
        {
          sender: {
            id: "sender-redacted-001",
            login: "viewer_redacted_001",
            displayName: "Viewer Redacted 001",
          },
          badges: [{ id: "badge-redacted-001", setId: "subscriber", version: "1" }],
          fragments: [
            { type: "text", text: "Synthetic fixture message " },
            { type: "emote", text: "SyntheticEmote", emoteId: "emote-redacted-001" },
          ],
        },
      ],
    });
  });

  it("distinguishes empty, unsupported, and transient source outcomes", () => {
    expect(parseTwitchChatReplayPage(emptyPage, "video-redacted-empty")).toEqual({
      capability: "empty",
      videoId: "video-redacted-empty",
    });
    expect(parseTwitchChatReplayPage(unsupportedPage, "video-redacted-missing")).toEqual({
      capability: "unsupported",
      videoId: "video-redacted-missing",
      reason: "video-not-found",
    });
    expect(parseTwitchChatReplayPage(transientError, "video-redacted-expired")).toEqual({
      capability: "transient-failure",
      videoId: "video-redacted-expired",
      reason: "service error",
    });
  });

  it("requests a Video offset anonymously and accepts a cursor for the next page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([observedPage]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTwitchChatReplayPage({
      videoId: "video-redacted-001",
      offsetSeconds: 60,
      cursor: "cursor-redacted-prior",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gql.twitch.tv/gql");
    expect(init.headers).toMatchObject({ "Client-Id": expect.any(String) });
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body as string)[0].variables).toEqual({
      videoID: "video-redacted-001",
      contentOffsetSeconds: 60,
      cursor: "cursor-redacted-prior",
    });
  });

  it("classifies authentication, rate-limit, and transient HTTP failures", async () => {
    const scenarios = [
      { status: 401, kind: "authentication", headers: {} },
      { status: 429, kind: "rate-limit", headers: { "Retry-After": "30" } },
      { status: 503, kind: "transient", headers: {} },
    ] as const;

    for (const scenario of scenarios) {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("", { status: scenario.status, headers: scenario.headers })
          )
      );
      const failure = await fetchTwitchChatReplayPage({ videoId: "video-redacted-001" }).catch(
        (error: unknown) => error
      );

      expect(failure).toBeInstanceOf(TwitchChatReplaySourceError);
      expect(failure).toMatchObject({
        kind: scenario.kind,
        status: scenario.status,
        ...(scenario.status === 429 ? { retryAfterSeconds: 30 } : {}),
      });
    }
  });
});
