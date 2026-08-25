import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: fetchFFZGlobal hits /v1/set/global; renderer relies on default_sets + sets shape
// Guards: fetchFFZRoom prefers name over channelId; lowercases the name (FFZ routes are case-sensitive); falls back to /v1/room/id/{channelId} when name absent
// Guards: 404 returns null sentinel (channel not on FFZ); 5xx throws

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
  fetchFFZBadges,
  fetchFFZGlobalEmotes,
  fetchFFZRoom,
} from "@/backend/services/emotes/ffz-emotes-service";

describe("fetchFFZBadges", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Guards: the Twitch chat badge catalog preserves FFZ's badge-to-user mapping.
  it("hits /v1/badges/ids and returns the parsed catalog on 200", async () => {
    const catalog = {
      badges: [
        {
          id: 1,
          name: "developer",
          title: "FFZ Developer",
          color: "#ff0000",
          replaces: null,
          image: "https://cdn.frankerfacez.com/badge/1/1",
          css: null,
          urls: {
            "1": "https://cdn.frankerfacez.com/badge/1/1",
            "4": "https://cdn.frankerfacez.com/badge/1/4",
          },
        },
      ],
      users: { "1": ["11111", 22222] },
    };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(catalog) });

    const result = await fetchFFZBadges();

    expect(mockState.state.fetchCalls[0]!.url).toBe("https://api.frankerfacez.com/v1/badges/ids");
    expect(result).toEqual({
      badges: [
        {
          id: 1,
          title: "FFZ Developer",
          color: "#ff0000",
          urls: {
            "1": "https://cdn.frankerfacez.com/badge/1/1",
            "4": "https://cdn.frankerfacez.com/badge/1/4",
          },
        },
      ],
      users: { "1": ["11111", 22222] },
    });
  });

  it("throws when the badge catalog request fails", async () => {
    mockState.state.responseQueue.push(
      { kind: "status", status: 503 },
      { kind: "status", status: 503 }
    );

    await expect(fetchFFZBadges()).rejects.toThrow(/503/);
  });
});

describe("fetchFFZGlobalEmotes", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits /v1/set/global and returns parsed JSON on 200", async () => {
    const globals = {
      default_sets: [3],
      sets: { "3": { id: 3, _type: 0, title: "Global", emoticons: [] } },
    };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(globals) });

    const result = await fetchFFZGlobalEmotes();

    expect(mockState.state.fetchCalls[0]!.url).toBe("https://api.frankerfacez.com/v1/set/global");
    expect(result).toEqual(globals);
  });

  it("throws on non-2xx (global set should always exist)", async () => {
    mockState.state.responseQueue.push(
      { kind: "status", status: 503 },
      { kind: "status", status: 503 }
    );
    await expect(fetchFFZGlobalEmotes()).rejects.toThrow(/503/);
  });
});

describe("fetchFFZRoom", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers name over channelId and lowercases it (FFZ routes are case-sensitive)", async () => {
    mockState.state.responseQueue.push({
      kind: "ok",
      body: '{"room":{"set":1},"sets":{}}',
    });
    await fetchFFZRoom({ kind: "name", name: "XQc" });
    expect(mockState.state.fetchCalls[0]!.url).toBe("https://api.frankerfacez.com/v1/room/xqc");
  });

  it("falls back to /v1/room/id/{channelId} when name is absent", async () => {
    mockState.state.responseQueue.push({
      kind: "ok",
      body: '{"room":{"set":1},"sets":{}}',
    });
    await fetchFFZRoom({ kind: "channel-id", channelId: "71092938" });
    expect(mockState.state.fetchCalls[0]!.url).toBe(
      "https://api.frankerfacez.com/v1/room/id/71092938"
    );
  });

  it("returns the parsed FFZRoomResponse on 200", async () => {
    const room = {
      room: {
        _id: 1,
        twitch_id: 71092938,
        youtube_id: null,
        id: "xqc",
        is_group: false,
        display_name: "xQc",
        set: 10,
        moderator_badge: null,
        user_badges: {},
        css: null,
      },
      sets: {},
    };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(room) });

    const result = await fetchFFZRoom({ kind: "name", name: "xqc" });

    expect(result).toEqual({
      room: {
        _id: 1,
        twitch_id: 71092938,
        id: "xqc",
        is_group: false,
        display_name: "xQc",
        set: 10,
        moderator_badge: null,
      },
      sets: {},
    });
  });

  it("returns null on 404 (channel not on FFZ)", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 404 });
    const result = await fetchFFZRoom({ kind: "name", name: "xqc" });
    expect(result).toBeNull();
  });

  it("throws on 5xx", async () => {
    mockState.state.responseQueue.push(
      { kind: "status", status: 503 },
      { kind: "status", status: 503 }
    );
    await expect(fetchFFZRoom({ kind: "name", name: "xqc" })).rejects.toThrow(/503/);
  });
});
