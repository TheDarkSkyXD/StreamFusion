import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: getModeratedChannels — the Helix `/moderation/channels` wire contract.
// URL/method/headers + pagination cursor following + 50-page safety cap + the
// "auth failure returns empty array (does not throw)" path that lets the rest
// of the app keep running when the token lacks `user:read:moderated_channels`.
// Rewritten in U20.c to stub global fetch (the wire boundary) instead of the
// `api.get` Ky-wrapper, so the assertions land on the actual Helix request
// instead of the intermediate client mock — same pattern the sibling
// twitch-helix-moderation-mutations.test.ts uses.

import {
  getModeratedChannels,
  getModeratedChannelsResult,
} from "@/backend/api/platforms/twitch/twitch-helix-moderation";

let fetchCalls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
let nextResponses: Array<{ status: number; body: unknown } | { throw: Error }> = [];

beforeEach(() => {
  fetchCalls = [];
  nextResponses = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    // Ky passes a Request object; the URL/method/headers live on it, not in `init`.
    let url: string;
    let method: string;
    let headers: Record<string, string> = {};
    if (input instanceof Request) {
      url = input.url;
      method = input.method;
      input.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else {
      url = typeof input === "string" ? input : input.toString();
      method = (init?.method as string) ?? "GET";
      const h = init?.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v;
      } else if (h && typeof h === "object") {
        headers = h as Record<string, string>;
      }
    }
    fetchCalls.push({ url, method, headers });

    const next = nextResponses.shift();
    if (!next) {
      throw new Error(
        `fetch call without a queued response (call #${fetchCalls.length} url=${url})`
      );
    }
    if ("throw" in next) throw next.throw;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      statusText: "",
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getModeratedChannels", () => {
  it("keeps authorization failure distinct from a verified empty channel list", async () => {
    nextResponses.push({ status: 401, body: { message: "Missing scope" } });

    await expect(
      getModeratedChannelsResult("user1", "token-without-scope", "myclient")
    ).resolves.toEqual({
      state: "failed",
      reason: "authorization",
      channels: [],
    });
  });

  it("keeps later-page failure distinct from a complete authority result", async () => {
    const firstPageChannel = {
      broadcaster_id: "100",
      broadcaster_login: "streamer",
      broadcaster_name: "Streamer",
    };
    nextResponses.push({
      status: 200,
      body: { data: [firstPageChannel], pagination: { cursor: "page-2" } },
    });
    nextResponses.push({ status: 403, body: { message: "Forbidden" } });

    await expect(
      getModeratedChannelsResult("user1", "expiring-token", "myclient")
    ).resolves.toEqual({
      state: "partial",
      reason: "authorization",
      channels: [firstPageChannel],
    });
  });

  it("returns channels from a single page and sends correct URL + headers", async () => {
    const channel = {
      broadcaster_id: "100",
      broadcaster_login: "streamer",
      broadcaster_name: "Streamer",
    };
    nextResponses.push({ status: 200, body: { data: [channel], pagination: {} } });

    const result = await getModeratedChannels("user1", "mytoken", "myclient");

    expect(result).toEqual([channel]);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/moderation/channels");
    expect(fetchCalls[0].url).toContain("user_id=user1");
    expect(fetchCalls[0].url).toContain("first=100");
    // Headers normalise to lowercase via the Request -> Headers iteration.
    expect(fetchCalls[0].headers["client-id"]).toBe("myclient");
    expect(fetchCalls[0].headers.authorization).toBe("Bearer mytoken");
  });

  it("follows pagination cursor across pages", async () => {
    const ch1 = { broadcaster_id: "1", broadcaster_login: "a", broadcaster_name: "A" };
    const ch2 = { broadcaster_id: "2", broadcaster_login: "b", broadcaster_name: "B" };

    nextResponses.push({ status: 200, body: { data: [ch1], pagination: { cursor: "page2" } } });
    nextResponses.push({ status: 200, body: { data: [ch2], pagination: {} } });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([ch1, ch2]);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].url).toContain("after=page2");
  });

  it("returns empty array when fetch throws (auth failure / network down)", async () => {
    nextResponses.push({ throw: new Error("401 Unauthorized") });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([]);
  });

  it("returns empty array when body has no data", async () => {
    nextResponses.push({ status: 200, body: { pagination: {} } });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([]);
  });

  it("returns empty array on null body gracefully", async () => {
    nextResponses.push({ status: 200, body: null });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([]);
  });

  it("hard-caps at 50 pages to prevent infinite loops", async () => {
    const ch = { broadcaster_id: "x", broadcaster_login: "x", broadcaster_name: "X" };
    // Queue enough infinite-cursor pages that the cap (50) is the only stop.
    for (let i = 0; i < 60; i++) {
      nextResponses.push({
        status: 200,
        body: { data: [ch], pagination: { cursor: "forever" } },
      });
    }

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(fetchCalls).toHaveLength(50);
    expect(result).toHaveLength(50);
  });
});
