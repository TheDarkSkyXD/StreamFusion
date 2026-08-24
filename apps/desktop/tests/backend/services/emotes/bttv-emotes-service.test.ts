import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: fetchBTTVGlobal hits /3/cached/emotes/global; renderer relies on the array shape
// Guards: fetchBTTVUserByTwitchId composes /3/cached/users/twitch/{id}; 200 returns parsed JSON, 404 returns null sentinel (channel not on BTTV), 5xx throws so the renderer's catch can downgrade to warn

const mockState = vi.hoisted(() => {
  type QueuedResponse =
    | { kind: "ok"; body: string; status?: number }
    | { kind: "status"; status: number; body?: string }
    | { kind: "error"; message: string };

  const state = {
    responseQueue: [] as QueuedResponse[],
    fetchCalls: [] as Array<{ url: string }>,
  };

  async function fakeFetch(url: string): Promise<Response> {
    state.fetchCalls.push({ url });
    const next = state.responseQueue.shift();
    if (!next) return new Promise<Response>(() => {});
    if (next.kind === "error") throw new Error(next.message);
    if (next.kind === "status") return new Response(next.body ?? "", { status: next.status });
    return new Response(next.body, { status: next.status ?? 200 });
  }

  return { state, fakeFetch };
});

vi.mock("electron", () => ({
  net: {
    fetch: (url: string) => mockState.fakeFetch(url),
  },
}));

import {
  fetchBTTVBadges,
  fetchBTTVGlobalEmotes,
  fetchBTTVUserByTwitchId,
} from "@/backend/services/emotes/bttv-emotes-service";

describe("fetchBTTVBadges", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Guards: the Twitch chat badge catalog comes from BTTV's cached badge endpoint unchanged.
  it("hits /3/cached/badges and returns the parsed catalog on 200", async () => {
    const badges = [
      {
        id: "54ee2465b822020506c52a52",
        name: "night",
        displayName: "Night",
        providerId: "user123",
        badge: {
          type: 1,
          description: "BTTV Developer",
          svg: "https://cdn.betterttv.net/badge/developer.svg",
        },
      },
    ];
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(badges) });

    const result = await fetchBTTVBadges();

    expect(mockState.state.fetchCalls[0]!.url).toBe("https://api.betterttv.net/3/cached/badges");
    expect(result).toEqual([
      {
        providerId: "user123",
        badge: {
          description: "BTTV Developer",
          svg: "https://cdn.betterttv.net/badge/developer.svg",
        },
      },
    ]);
  });

  it("throws when the badge catalog request fails", async () => {
    mockState.state.responseQueue.push(
      { kind: "status", status: 503 },
      { kind: "status", status: 503 }
    );

    await expect(fetchBTTVBadges()).rejects.toThrow(/503/);
  });
});

describe("fetchBTTVGlobalEmotes", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits /3/cached/emotes/global and returns parsed JSON on 200", async () => {
    const globals = [{ id: "1", code: "GlobalEmote", imageType: "webp", animated: false }];
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(globals) });

    const result = await fetchBTTVGlobalEmotes();

    expect(mockState.state.fetchCalls[0]!.url).toBe(
      "https://api.betterttv.net/3/cached/emotes/global"
    );
    expect(result).toEqual(globals);
  });

  it("throws on non-2xx (global set should always exist)", async () => {
    mockState.state.responseQueue.push(
      { kind: "status", status: 503 },
      { kind: "status", status: 503 }
    );
    await expect(fetchBTTVGlobalEmotes()).rejects.toThrow(/503/);
  });
});

describe("fetchBTTVUserByTwitchId", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits /3/cached/users/twitch/{id} and returns parsed JSON on 200", async () => {
    const user = {
      id: "abc",
      bots: [],
      avatar: "",
      channelEmotes: [{ id: "1", code: "ChannelEmote", imageType: "webp", animated: false }],
      sharedEmotes: [],
    };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(user) });

    const result = await fetchBTTVUserByTwitchId("71092938");

    expect(mockState.state.fetchCalls[0]!.url).toBe(
      "https://api.betterttv.net/3/cached/users/twitch/71092938"
    );
    expect(result).toEqual(user);
  });

  it("returns null on 404 (channel not on BTTV)", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 404 });
    const result = await fetchBTTVUserByTwitchId("71092938");
    expect(result).toBeNull();
  });

  it("throws on 5xx so the caller can log warn and degrade", async () => {
    mockState.state.responseQueue.push(
      { kind: "status", status: 503 },
      { kind: "status", status: 503 }
    );
    await expect(fetchBTTVUserByTwitchId("71092938")).rejects.toThrow(/503/);
  });
});
