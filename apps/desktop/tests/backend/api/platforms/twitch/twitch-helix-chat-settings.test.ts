import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getChatSettings } from "@/backend/api/platforms/twitch/twitch-helix-chat-settings";

const originalFetch = globalThis.fetch;

function mockFetchResponse(init: {
  status: number;
  body?: unknown;
  statusText?: string;
}): typeof globalThis.fetch {
  return vi.fn(async () => {
    return new Response(
      init.body !== undefined ? JSON.stringify(init.body) : null,
      { status: init.status, statusText: init.statusText },
    ) as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("getChatSettings", () => {
  it("happy path returns the first data payload (moderator context)", async () => {
    const payload = {
      broadcaster_id: "12345",
      slow_mode: true,
      slow_mode_wait_time: 30,
      follower_mode: true,
      follower_mode_duration: 10,
      subscriber_mode: false,
      emote_mode: false,
      unique_chat_mode: false,
    };
    globalThis.fetch = mockFetchResponse({ status: 200, body: { data: [payload] } });

    const result = await getChatSettings("12345");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.broadcaster_id).toBe("12345");
      expect(result.payload.slow_mode).toBe(true);
      expect(result.payload.follower_mode_duration).toBe(10);
    }
  });

  it("viewer context (no moderator_chat_delay fields) still succeeds", async () => {
    const payload = {
      broadcaster_id: "12345",
      slow_mode: false,
      follower_mode: false,
      subscriber_mode: false,
      emote_mode: false,
      unique_chat_mode: false,
    };
    globalThis.fetch = mockFetchResponse({ status: 200, body: { data: [payload] } });

    const result = await getChatSettings("12345");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.non_moderator_chat_delay).toBeUndefined();
    }
  });

  it("401 returns unauthorized", async () => {
    globalThis.fetch = mockFetchResponse({
      status: 401,
      body: { error: "Unauthorized", status: 401, message: "Token expired" },
    });

    const result = await getChatSettings("12345");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthorized");
      expect(result.message).toContain("Token expired");
    }
  });

  it("404 returns not-found", async () => {
    globalThis.fetch = mockFetchResponse({
      status: 404,
      body: { error: "Not Found", status: 404, message: "Unknown broadcaster" },
    });
    const result = await getChatSettings("not-real");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not-found");
  });

  it("429 returns rate-limited", async () => {
    globalThis.fetch = mockFetchResponse({
      status: 429,
      body: { error: "Too Many Requests", status: 429, message: "Slow down" },
    });
    const result = await getChatSettings("12345");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("rate-limited");
  });

  it("empty data array returns network failure (not silent success)", async () => {
    globalThis.fetch = mockFetchResponse({ status: 200, body: { data: [] } });
    const result = await getChatSettings("12345");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });

  it("network error returns network kind", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const result = await getChatSettings("12345");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toContain("fetch failed");
    }
  });

  it("respects an external AbortSignal (caller-initiated abort)", async () => {
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      // Simulate a real fetch that respects the signal.
      const signal = init?.signal;
      if (signal?.aborted) {
        const err = new Error("Request aborted");
        err.name = "AbortError";
        throw err;
      }
      return new Response(JSON.stringify({ data: [{}] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const ac = new AbortController();
    ac.abort();
    const result = await getChatSettings("12345", ac.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Caller-initiated abort surfaces as "network" since signal.aborted is true
      // for the caller's signal — distinguishes it from a timeout abort.
      expect(result.kind).toBe("network");
    }
  });
});
