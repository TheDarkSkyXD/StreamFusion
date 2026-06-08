import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: fetch7TVUserByConnection composes the 7TV v3 URL with uppercase platform alias (KICK / TWITCH) — 7tv.io routes by exact alias case; lowercase 404s
// Guards: 200 returns parsed JSON; 404 returns null sentinel so callers can distinguish "no linked 7TV account" from a real error without try/catch
// Guards: 5xx surfaces an Error (not silently null) so the renderer's emote degradation can log a warn and fall back to []
// Guards: fetch7TVGlobalEmoteSet hits /v3/emote-sets/global; the renderer relies on this set as the always-present floor

const mockState = vi.hoisted(() => {
  type QueuedResponse =
    | { kind: "ok"; body: string; status?: number }
    | { kind: "status"; status: number; body?: string }
    | { kind: "error"; message: string };

  const state = {
    responseQueue: [] as QueuedResponse[],
    fetchCalls: [] as Array<{ url: string; options?: unknown }>,
  };

  async function fakeFetch(url: string, options?: unknown): Promise<Response> {
    state.fetchCalls.push({ url, options });
    const next = state.responseQueue.shift();
    if (!next) {
      return new Promise<Response>(() => {});
    }
    if (next.kind === "error") {
      throw new Error(next.message);
    }
    if (next.kind === "status") {
      return new Response(next.body ?? "", { status: next.status });
    }
    return new Response(next.body, { status: next.status ?? 200 });
  }

  return { state, fakeFetch };
});

vi.mock("electron", () => ({
  net: {
    fetch: (url: string, options?: unknown) => mockState.fakeFetch(url, options),
  },
}));

import { fetch7TVGlobalEmoteSet, fetch7TVUserByConnection } from "@/backend/services/emotes/7tv-emotes-service";

describe("fetch7TVUserByConnection", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits /v3/users/KICK/{id} and returns parsed JSON on 200", async () => {
    const userJson = {
      id: "01HX2YE7E0000VZ8MQ",
      username: "broadcaster",
      emote_set: { id: "01HX2", emotes: [] },
    };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(userJson) });

    const result = await fetch7TVUserByConnection("kick", "58371235");

    expect(mockState.state.fetchCalls).toHaveLength(1);
    expect(mockState.state.fetchCalls[0]!.url).toBe("https://7tv.io/v3/users/KICK/58371235");
    expect(result).toEqual(userJson);
  });

  it("returns null on 404 (Kick user has not linked 7TV)", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 404 });

    const result = await fetch7TVUserByConnection("kick", "58371235");

    expect(result).toBeNull();
  });

  it("throws on 5xx so callers can distinguish a real failure from a missing connection", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 503 });

    await expect(fetch7TVUserByConnection("kick", "58371235")).rejects.toThrow(/503/);
  });

  it("propagates network errors so callers can degrade gracefully", async () => {
    mockState.state.responseQueue.push({ kind: "error", message: "ECONNRESET" });

    await expect(fetch7TVUserByConnection("kick", "58371235")).rejects.toThrow(/ECONNRESET/);
  });

  it("uppercases the platform alias (KICK / TWITCH) — 7TV's router is case-sensitive", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: "{}" });

    await fetch7TVUserByConnection("twitch", "12345");

    expect(mockState.state.fetchCalls[0]!.url).toBe("https://7tv.io/v3/users/TWITCH/12345");
  });
});

describe("fetch7TVGlobalEmoteSet", () => {
  beforeEach(() => {
    mockState.state.responseQueue.length = 0;
    mockState.state.fetchCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hits /v3/emote-sets/global and returns parsed JSON on 200", async () => {
    const setJson = { id: "global", emotes: [{ id: "01F", name: "FeelsOkayMan" }] };
    mockState.state.responseQueue.push({ kind: "ok", body: JSON.stringify(setJson) });

    const result = await fetch7TVGlobalEmoteSet();

    expect(mockState.state.fetchCalls).toHaveLength(1);
    expect(mockState.state.fetchCalls[0]!.url).toBe("https://7tv.io/v3/emote-sets/global");
    expect(result).toEqual(setJson);
  });

  it("throws on any non-2xx (the global set is always expected to exist)", async () => {
    mockState.state.responseQueue.push({ kind: "status", status: 503 });

    await expect(fetch7TVGlobalEmoteSet()).rejects.toThrow(/503/);
  });
});
