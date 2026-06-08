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
  fetchFFZGlobalEmotes,
  fetchFFZRoom,
} from "@/backend/services/emotes/ffz-emotes-service";

describe("fetchFFZGlobalEmotes", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits /v1/set/global and returns parsed JSON on 200", async () => {
    const globals = { default_sets: [3], sets: { "3": { id: 3, _type: 0, title: "Global", emoticons: [] } } };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(globals) });

    const result = await fetchFFZGlobalEmotes();

    expect(mockState.state.fetchCalls[0]!.url).toBe("https://api.frankerfacez.com/v1/set/global");
    expect(result).toEqual(globals);
  });

  it("throws on non-2xx (global set should always exist)", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 503 });
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
    mockState.state.responseQueue.push({ kind: "ok", body: "{}" });
    await fetchFFZRoom({ name: "XQc", channelId: "71092938" });
    expect(mockState.state.fetchCalls[0]!.url).toBe("https://api.frankerfacez.com/v1/room/xqc");
  });

  it("falls back to /v1/room/id/{channelId} when name is absent", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: "{}" });
    await fetchFFZRoom({ channelId: "71092938" });
    expect(mockState.state.fetchCalls[0]!.url).toBe(
      "https://api.frankerfacez.com/v1/room/id/71092938"
    );
  });

  it("returns the parsed FFZRoomResponse on 200", async () => {
    const room = { room: { _id: 1, twitch_id: 71092938, id: "xqc", is_group: false, display_name: "xQc", set: 10, moderator_badge: null }, sets: {} };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(room) });

    const result = await fetchFFZRoom({ name: "xqc" });

    expect(result).toEqual(room);
  });

  it("returns null on 404 (channel not on FFZ)", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 404 });
    const result = await fetchFFZRoom({ name: "xqc" });
    expect(result).toBeNull();
  });

  it("throws on 5xx", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 503 });
    await expect(fetchFFZRoom({ name: "xqc" })).rejects.toThrow(/503/);
  });
});
