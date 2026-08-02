import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/backend/logging/logger";

// Guards: followed Kick stream live status uses the current 100-ID bulk API instead of the deprecated endpoint or fan-out legacy slug checks.
// Guards: successful Kick stream metadata fetch seeds live playback cache so stream opens can resolve from memory.
// Guards: Kick public-stream-cache + fan-out 4-part contract (regressions cb0b7b6 + 6d3606d, refactored in 640870a).
// Guards: positive-cache TTL > poll interval — a second call to the same slug within 90s must NOT hit electron.net.fetch again. Without this, the 60s `useFollowedStreams` poll re-bursts on every cycle.
// Guards: stagger fires AFTER cache check — a cache-hit path returns synchronously with `staggerOffsetMs > 0`. Otherwise back-to-back same-slug callers eat a delay they don't need.
// Guards: AbortController is scoped per dispatch — an aborted staggerDelay rejects with an "AbortError" before reaching the network; orphan stagger timers from a stale dispatch don't fire into the network.
// Guards: a transient timeout serves the last-known-good stream instead of returning null, so followed Kick streams do not disappear during a flaky refresh.

// Guards: an official Kick channel response with no active stream returns route-matched offline evidence instead of ambiguous null, so stale player and channel caches cannot keep a finished stream live.

// The vi.mock factory is hoisted above all top-level declarations and cannot
// close over variables defined later in this file. `vi.hoisted` runs at the
// same hoist time, so the shared mutable state + fake-fetch factory live
// there together.
const mockState = vi.hoisted(() => {
  type QueuedResponse = { kind: "ok"; body: string } | { kind: "error"; message: string };

  const state = {
    responseQueue: [] as QueuedResponse[],
    netRequestCalls: [] as Array<{ url: string }>,
  };

  // Fake net.fetch that dequeues from responseQueue and returns a Response-like object.
  // If the queue is empty, the promise never resolves (simulating a hung request —
  // AbortSignal.timeout from the source will fire and reject it).
  async function fakeFetch(url: string, _options?: unknown): Promise<Response> {
    state.netRequestCalls.push({ url });
    const next = state.responseQueue.shift();
    if (!next) {
      // Hang forever — AbortSignal.timeout in the source will abort this.
      return new Promise<Response>(() => {});
    }
    if (next.kind === "error") {
      throw new Error(next.message);
    }
    return new Response(next.body, { status: 200 });
  }

  return { state, fakeFetch };
});

// `getPublicStreamBySlug` source does `require("electron")` dynamically.
// vi.mock works for both `import` and `require`.
vi.mock("electron", () => ({
  net: {
    fetch: (url: string, options?: unknown) => mockState.fakeFetch(url, options),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
}));

const platformHealthSpies = vi.hoisted(() => ({
  recordPlatformFailure: vi.fn(),
  recordPlatformSuccess: vi.fn(),
  recordPlatformLocalNetError: vi.fn(),
  isPlatformHealthy: vi.fn(() => true),
  getPlatformHealth: vi.fn((): string => "healthy"),
}));

vi.mock("@/backend/api/unified/platform-health", () => ({
  recordPlatformFailure: platformHealthSpies.recordPlatformFailure,
  recordPlatformSuccess: platformHealthSpies.recordPlatformSuccess,
  recordPlatformLocalNetError: platformHealthSpies.recordPlatformLocalNetError,
  isPlatformHealthy: platformHealthSpies.isPlatformHealthy,
  getPlatformHealth: platformHealthSpies.getPlatformHealth,
}));

const LIVE_BODY = JSON.stringify({
  slug: "ac7ionman",
  user: {
    username: "Ac7ionMan",
    profile_picture: "https://files.kick.com/avatars/ac7ionman.webp",
    verified: { id: 1 },
  },
  livestream: {
    id: 999,
    channel_id: 12345,
    session_title: "Live now",
    viewer_count: 42,
    thumbnail: { url: "https://files.kick.com/thumb.webp" },
    created_at: "2026-05-20T12:00:00Z",
    language: "en",
    custom_tags: [],
    tags: [],
    is_mature: false,
    categories: [{ id: 1, name: "Just Chatting" }],
  },
  playback_url: "https://playback.example.test/live/ac7ionman.m3u8?token=secret",
});

describe("getPublicStreamBySlug — fan-out + cache 4-part contract", () => {
  let getPublicStreamBySlug: typeof import("@/backend/api/platforms/kick/endpoints/stream-endpoints").getPublicStreamBySlug;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockState.state.responseQueue.length = 0;
    mockState.state.netRequestCalls.length = 0;
    ({ getPublicStreamBySlug } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("contract 1: positive-cache TTL (90s) > poll interval — second call within window hits cache, not network", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    const first = await getPublicStreamBySlug("ac7ionman");
    expect(first?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1);

    // 60 seconds later — within the 90-second TTL.
    await vi.advanceTimersByTimeAsync(60_000);

    const second = await getPublicStreamBySlug("ac7ionman");
    expect(second?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1); // Still 1 — no second network hit.
  });

  it("seeds the Kick playback cache from the same channel payload", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    const { getCachedKickLivePlayback } =
      await import("@/backend/api/platforms/kick/kick-playback-cache");

    await getPublicStreamBySlug("ac7ionman");

    const playback = getCachedKickLivePlayback("ac7ionman");
    expect(playback).toEqual(
      expect.objectContaining({
        url: "https://playback.example.test/live/ac7ionman.m3u8?token=secret",
        format: "hls",
        sourceField: "playback_url",
      })
    );
  });

  it("maps the Kick verified state from public channel payloads", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    const result = await getPublicStreamBySlug("ac7ionman");

    expect(result?.channelIsVerified).toBe(true);
  });

  it("contract 2: stagger fires AFTER cache check — cache-hit path is synchronous even with staggerOffsetMs > 0", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    // Prime the cache.
    await getPublicStreamBySlug("ac7ionman");
    expect(mockState.state.netRequestCalls).toHaveLength(1);

    // Second call with a non-zero stagger. The stagger only fires for
    // cache-miss work; a cache-hit must short-circuit synchronously.
    // We DON'T advance fake timers — if the implementation incorrectly
    // staggered before checking the cache, the await below would hang.
    const second = await getPublicStreamBySlug("ac7ionman", 500);
    expect(second?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1); // Cache hit, no stagger.
  });

  it("contract 3: AbortController is scoped per dispatch — an aborted signal short-circuits before the network", async () => {
    const ac = new AbortController();
    ac.abort(); // Pre-aborted: simulates a stale-dispatch signal.

    // staggerDelay sees the already-aborted signal at the top of its body
    // and rejects synchronously with AbortError. The outer in-flight promise
    // rejects, so the network call is never made.
    await expect(getPublicStreamBySlug("brand-new-slug", 200, ac.signal)).rejects.toThrow(
      /AbortError/
    );

    expect(mockState.state.netRequestCalls).toHaveLength(0);
  });

  it("contract 4: transient timeout after poll-cache expiry serves the last-known-good live stream", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    const first = await getPublicStreamBySlug("ac7ionman");
    expect(first?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1);

    // Expire the 90s normal poll-hit cache while staying inside the 5min
    // last-known-good stale window used for transient failures.
    await vi.advanceTimersByTimeAsync(91_000);

    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:timeout" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:timeout" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:timeout" });

    const retry = getPublicStreamBySlug("ac7ionman");
    await vi.advanceTimersByTimeAsync(10_000);
    const second = await retry;

    expect(second?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(4);
  });
});

describe("getStreamsByBroadcasterIds", () => {
  it("calls the current user-livestreams endpoint with repeated user_id params", async () => {
    vi.resetModules();
    vi.useRealTimers();
    const { getStreamsByBroadcasterIds } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints");
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [
          {
            broadcaster_user: {
              id: 123,
              username: "New Slug",
              profile_picture: "https://example.com/avatar.webp",
            },
            channel: { slug: "new-slug" },
            id: "stream-456",
            title: "Live now",
            language_code: "en",
            has_mature_content: false,
            viewer_count: 42,
            thumbnail: "https://example.com/thumb.webp",
            started_at: "2026-06-29T12:00:00Z",
            tags: ["chatting"],
            category: { id: 15, name: "Just Chatting", thumbnail: "" },
          },
        ],
      }),
    };

    const result = await getStreamsByBroadcasterIds(client as any, [123, 123, 789]);

    expect(client.request).toHaveBeenCalledWith(
      "/users/livestreams?user_id=123&user_id=789",
      undefined,
      "app"
    );
    expect(result).toEqual([
      expect.objectContaining({
        channelId: "123",
        channelName: "new-slug",
        channelDisplayName: "New Slug",
        isLive: true,
      }),
    ]);
  });

  it("keeps each bulk lookup within the documented 100-user limit", async () => {
    vi.resetModules();
    vi.useRealTimers();
    const { getStreamsByBroadcasterIds } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints");
    const client = {
      request: vi.fn().mockResolvedValue({ data: [] }),
    };

    await getStreamsByBroadcasterIds(
      client as any,
      Array.from({ length: 101 }, (_, index) => index + 1)
    );

    expect(client.request).toHaveBeenCalledTimes(2);
    const firstPath = client.request.mock.calls[0]?.[0] as string;
    const secondPath = client.request.mock.calls[1]?.[0] as string;
    expect((firstPath.match(/user_id=/g) ?? []).length).toBe(100);
    expect((secondPath.match(/user_id=/g) ?? []).length).toBe(1);
    expect(secondPath).toContain("user_id=101");
  });
});

describe("getStreamBySlug live-state authority", () => {
  it("returns explicit offline evidence when the official channel response says the stream ended", async () => {
    vi.resetModules();
    vi.useRealTimers();
    const { getStreamBySlug } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints");
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [
          {
            broadcaster_user_id: 75154627,
            slug: "jollyirl",
            channel_description: "IRL streamer",
            banner_picture: null,
            stream_title: "India Day 18",
            category: { id: 8549, name: "IRL", thumbnail: "" },
            stream: null,
          },
        ],
      }),
    };

    const result = await getStreamBySlug(client as any, "JollyIRL");

    expect(result).toEqual(
      expect.objectContaining({
        platform: "kick",
        channelId: "75154627",
        channelName: "jollyirl",
        isLive: false,
        startedAt: null,
      })
    );
    expect(client.request).toHaveBeenCalledTimes(1);
  });
});

describe("getPublicTopStreams", () => {
  let getPublicTopStreams: typeof import("@/backend/api/platforms/kick/endpoints/stream-endpoints").getPublicTopStreams;

  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();
    mockState.state.responseQueue.length = 0;
    mockState.state.netRequestCalls.length = 0;
    ({ getPublicTopStreams } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints"));
  });

  it("parses private livestream pages and forwards the real next cursor", async () => {
    const livestreams = Array.from({ length: 50 }, (_, index) => ({
      id: `stream-${index}`,
      streamer: {
        user: {
          id: `user-${index}`,
          username: `Alpha${index}`,
          profile_picture: `https://example.com/${index}.webp`,
          verified: index === 0 ? { id: 1 } : null,
        },
        channel: {
          id: `channel-${index}`,
          slug: `alpha-${index}`,
        },
      },
      metadata: {
        title: `Live ${index}`,
        language: "en",
        has_mature_content: false,
        category: { id: "category-1", name: "Just Chatting", slug: "just-chatting" },
      },
      viewers_count: 100 - index,
      thumbnail_url: `https://example.com/thumb-${index}.webp`,
      started_at: "2026-06-09T12:00:00Z",
    }));
    mockState.state.responseQueue.push({
      kind: "ok",
      body: JSON.stringify({
        status: { code: 200 },
        data: {
          livestreams,
          next_cursor: "livestream_next",
          version: "1",
        },
      }),
    });

    const result = await getPublicTopStreams({ limit: 10, cursor: "livestream_prev" });

    expect(mockState.state.netRequestCalls[0]?.url).toContain(
      "https://api.kick.com/private/v1/livestreams?cursor=livestream_prev"
    );
    expect(result.data).toHaveLength(10);
    expect(result.data[0].channelName).toBe("alpha-0");
    expect(result.data[0].channelIsVerified).toBe(true);
    expect(result.cursor).toBe("livestream_next");
  });
});

describe("getPublicStreamBySlug — platform-health instrumentation (slice 01)", () => {
  let getPublicStreamBySlug: typeof import("@/backend/api/platforms/kick/endpoints/stream-endpoints").getPublicStreamBySlug;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockState.state.responseQueue.length = 0;
    mockState.state.netRequestCalls.length = 0;
    platformHealthSpies.recordPlatformFailure.mockReset();
    platformHealthSpies.recordPlatformSuccess.mockReset();
    ({ getPublicStreamBySlug } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a success on a 200 with a live payload", async () => {
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    await getPublicStreamBySlug("ac7ionman");

    expect(platformHealthSpies.recordPlatformSuccess).toHaveBeenCalledWith("kick");
    expect(platformHealthSpies.recordPlatformFailure).not.toHaveBeenCalled();
  });

  it("records a server-5xx failure on a 502 response (no retry on the rest of the loop)", async () => {
    // Three 502s — one per attempt in the existing 3× retry loop.
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });

    const promise = getPublicStreamBySlug("ac7ionman");
    // Drain the 1s / 2s backoff sleeps that gate retries 2 and 3.
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const failures = platformHealthSpies.recordPlatformFailure.mock.calls;
    expect(failures.length).toBeGreaterThan(0);
    for (const [platform, klass] of failures) {
      expect(platform).toBe("kick");
      expect(klass).toBe("server-5xx");
    }
  });

  it("records a timeout failure when fetch throws a TimeoutError", async () => {
    // Simulate AbortSignal.timeout firing by throwing a TimeoutError-shaped
    // error. The source normalizes name === "TimeoutError" | "AbortError"
    // into "TRANSIENT:timeout" before recording. Using a thrown error is
    // load-bearing here: AbortSignal.timeout itself relies on the real
    // timer queue and won't fire under vi.useFakeTimers.
    const orig = mockState.fakeFetch;
    mockState.fakeFetch = async (_url: string) => {
      const err = new Error("The operation timed out") as Error & { name: string };
      err.name = "TimeoutError";
      throw err;
    };

    try {
      const promise = getPublicStreamBySlug("flaky-slug");
      // Drain 1s + 2s backoffs between the 3 attempts.
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;
    } finally {
      mockState.fakeFetch = orig;
    }

    const failures = platformHealthSpies.recordPlatformFailure.mock.calls;
    expect(failures.length).toBeGreaterThan(0);
    for (const [platform, klass] of failures) {
      expect(platform).toBe("kick");
      expect(klass).toBe("timeout");
    }
    expect(platformHealthSpies.recordPlatformSuccess).not.toHaveBeenCalled();
  });

  it("records a net-error failure on a TRANSIENT:net::ERR_* error", async () => {
    mockState.state.responseQueue.push({
      kind: "error",
      message: "net::ERR_NAME_NOT_RESOLVED",
    });
    mockState.state.responseQueue.push({
      kind: "error",
      message: "net::ERR_NAME_NOT_RESOLVED",
    });
    mockState.state.responseQueue.push({
      kind: "error",
      message: "net::ERR_NAME_NOT_RESOLVED",
    });

    const promise = getPublicStreamBySlug("dead-host");
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const failures = platformHealthSpies.recordPlatformFailure.mock.calls;
    expect(failures.length).toBeGreaterThan(0);
    for (const [platform, klass] of failures) {
      expect(platform).toBe("kick");
      expect(klass).toBe("net-error");
    }
  });

  it("treats a 404 as a success (channel doesn't exist, platform is fine)", async () => {
    // The source treats 404 as a non-error short-circuit (the channel just
    // doesn't exist). The PRD's excluded-classes list explicitly excludes
    // 404 from the failure counter, so it must record a success.
    mockState.state.netRequestCalls.length = 0;
    const orig = mockState.fakeFetch;
    // Push a synthetic Response with status 404 via a custom queue entry.
    // The fakeFetch helper only knows {kind:"ok", body} as a success — patch
    // it by registering a custom hook on responseQueue: shipping a body of
    // "" won't trigger a 404, so we use a temporary monkey-patch.
    // Simpler: feed a Response wrapper directly via a throw of the 404 path.
    // The source path for 404 is `res.status === 404` — bypassing parse;
    // both branches converge on success-cache write. To exercise this in
    // the existing fakeFetch shim we need a way to return non-200. Inject
    // by reassigning fakeFetch for this test only.
    mockState.fakeFetch = async (_url: string) =>
      new Response("", { status: 404 }) as unknown as Response;

    try {
      await getPublicStreamBySlug("nonexistent-slug");
    } finally {
      mockState.fakeFetch = orig;
    }

    expect(platformHealthSpies.recordPlatformSuccess).toHaveBeenCalledWith("kick");
    expect(platformHealthSpies.recordPlatformFailure).not.toHaveBeenCalled();
  });

  it("does NOT record on a non-TRANSIENT 'Status N' response (excluded per PRD)", async () => {
    // Single 401 — source classifies as non-transient ⇒ break out of the
    // retry loop ⇒ no platform-health record per the PRD exclusion list.
    const orig = mockState.fakeFetch;
    mockState.fakeFetch = async (_url: string) =>
      new Response("", { status: 401 }) as unknown as Response;

    try {
      await getPublicStreamBySlug("auth-required");
    } finally {
      mockState.fakeFetch = orig;
    }

    expect(platformHealthSpies.recordPlatformFailure).not.toHaveBeenCalled();
    expect(platformHealthSpies.recordPlatformSuccess).not.toHaveBeenCalled();
  });

  it("does NOT record on a parse error (excluded per PRD)", async () => {
    // 200 OK with invalid JSON — source throws "Failed to parse JSON",
    // breaks out, treated as a non-transient error.
    const orig = mockState.fakeFetch;
    mockState.fakeFetch = async (_url: string) =>
      new Response("{not-json", { status: 200 }) as unknown as Response;

    try {
      await getPublicStreamBySlug("broken-payload");
    } finally {
      mockState.fakeFetch = orig;
    }

    expect(platformHealthSpies.recordPlatformFailure).not.toHaveBeenCalled();
    expect(platformHealthSpies.recordPlatformSuccess).not.toHaveBeenCalled();
  });

  it("records success on the retry that succeeds even when earlier attempts failed", async () => {
    // First attempt times out, second attempt succeeds. Per-attempt
    // instrumentation: 1 failure + 1 success.
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    const promise = getPublicStreamBySlug("flaky-recovered");
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    expect(platformHealthSpies.recordPlatformFailure).toHaveBeenCalledWith("kick", "server-5xx");
    expect(platformHealthSpies.recordPlatformSuccess).toHaveBeenCalledWith("kick");
  });
});

describe("getPublicStreamBySlug — per-slug log suppression (slice 04)", () => {
  let getPublicStreamBySlug: typeof import("@/backend/api/platforms/kick/endpoints/stream-endpoints").getPublicStreamBySlug;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockState.state.responseQueue.length = 0;
    mockState.state.netRequestCalls.length = 0;
    platformHealthSpies.recordPlatformFailure.mockReset();
    platformHealthSpies.recordPlatformSuccess.mockReset();
    platformHealthSpies.isPlatformHealthy.mockReset();
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.debug).mockClear();
    ({ getPublicStreamBySlug } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("while healthy, first failure for a slug logs at warn", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);

    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });

    const promise = getPublicStreamBySlug("some-slug");
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const warnCalls = vi
      .mocked(logger.warn)
      .mock.calls.filter(([tag]) => tag === "Kick:Endpoints:Stream");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][1]).toMatch(/Failed to fetch public Kick stream/);
  });

  it("while degraded, first failure for a slug logs at debug instead of warn", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(false);

    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });

    const promise = getPublicStreamBySlug("some-slug");
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const warnCalls = vi
      .mocked(logger.warn)
      .mock.calls.filter(([tag]) => tag === "Kick:Endpoints:Stream");
    const debugCalls = vi
      .mocked(logger.debug)
      .mock.calls.filter(([tag]) => tag === "Kick:Endpoints:Stream");
    expect(warnCalls).toHaveLength(0);
    expect(debugCalls.length).toBeGreaterThanOrEqual(1);
    expect(debugCalls.some(([, msg]) => /Failed to fetch public Kick stream/.test(msg))).toBe(true);
  });

  it("after recovery, a subsequent failure logs at warn again", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);

    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });

    let promise = getPublicStreamBySlug("recover-slug");
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const warnCalls1 = vi
      .mocked(logger.warn)
      .mock.calls.filter(([tag]) => tag === "Kick:Endpoints:Stream");
    expect(warnCalls1).toHaveLength(1);

    const { clearKickStreamFailureCache } =
      await import("@/backend/api/platforms/kick/endpoints/stream-endpoints");
    clearKickStreamFailureCache();

    await vi.advanceTimersByTimeAsync(310_000);

    vi.mocked(logger.warn).mockClear();

    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });
    mockState.state.responseQueue.push({ kind: "error", message: "TRANSIENT:502" });

    promise = getPublicStreamBySlug("recover-slug");
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const warnCalls2 = vi
      .mocked(logger.warn)
      .mock.calls.filter(([tag]) => tag === "Kick:Endpoints:Stream");
    expect(warnCalls2).toHaveLength(1);
  });
});
