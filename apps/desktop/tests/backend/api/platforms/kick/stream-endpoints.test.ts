import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: Kick public-stream-cache + fan-out 4-part contract (regressions cb0b7b6 + 6d3606d, refactored in 640870a).
// Guards: positive-cache TTL > poll interval — a second call to the same slug within 90s must NOT hit electron.net.fetch again. Without this, the 60s `useFollowedStreams` poll re-bursts on every cycle.
// Guards: stagger fires AFTER cache check — a cache-hit path returns synchronously with `staggerOffsetMs > 0`. Otherwise back-to-back same-slug callers eat a delay they don't need.
// Guards: AbortController is scoped per dispatch — an aborted staggerDelay rejects with an "AbortError" before reaching the network; orphan stagger timers from a stale dispatch don't fire into the network.
// Guards: a transient timeout does NOT preempt a fresh positive cache — the timeout-TTL (30s) is intentionally suppressed when a successful fetch from the same slug is still within `PUBLIC_STREAM_POLL_HIT_TTL_MS` (90s). Otherwise a single 5s cold-TLS timeout would flash false "channel offline" UI on the stream-detail page.

// The vi.mock factory is hoisted above all top-level declarations and cannot
// close over variables defined later in this file. `vi.hoisted` runs at the
// same hoist time, so the shared mutable state + fake-fetch factory live
// there together.
const mockState = vi.hoisted(() => {
  type QueuedResponse =
    | { kind: "ok"; body: string }
    | { kind: "error"; message: string };

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
  isNetworkLikelyDown: vi.fn(() => false),
  recordTransientNetworkError: vi.fn(),
}));

const platformHealthSpies = vi.hoisted(() => ({
  recordPlatformFailure: vi.fn(),
  recordPlatformSuccess: vi.fn(),
}));

vi.mock("@/backend/api/unified/platform-health", () => ({
  recordPlatformFailure: platformHealthSpies.recordPlatformFailure,
  recordPlatformSuccess: platformHealthSpies.recordPlatformSuccess,
}));

const LIVE_BODY = JSON.stringify({
  slug: "ac7ionman",
  user: {
    username: "Ac7ionMan",
    profile_picture: "https://files.kick.com/avatars/ac7ionman.webp",
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
});

describe("getPublicStreamBySlug — fan-out + cache 4-part contract", () => {
  let getPublicStreamBySlug: typeof import("@/backend/api/platforms/kick/endpoints/stream-endpoints").getPublicStreamBySlug;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockState.state.responseQueue.length = 0;
    mockState.state.netRequestCalls.length = 0;
    ({ getPublicStreamBySlug } = await import(
      "@/backend/api/platforms/kick/endpoints/stream-endpoints"
    ));
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
    await expect(
      getPublicStreamBySlug("brand-new-slug", 200, ac.signal),
    ).rejects.toThrow(/AbortError/);

    expect(mockState.state.netRequestCalls).toHaveLength(0);
  });

  // Contract 4 (transient timeout does NOT poison a fresh positive cache)
  // is documented and shipped in the source (`stream-endpoints.ts` lines
  // 549-559: the `transient && fresh` early-return that skips the
  // negative-cache write). It is *not* covered by a unit test at this
  // integration layer because the guard only matters in an in-flight race —
  // the positive cache from t=0 must STILL be valid (<90s old) at the
  // moment a network attempt for the same slug *fails*. The positive
  // cache check happens BEFORE the network call in the happy path, so
  // a same-slug call within the window never reaches the network at all
  // (covered by contract 1). The race that the guard protects against
  // — positive cache expires mid-flight, the now-failed attempt evicts
  // a positive entry that another concurrent caller is about to re-prime
  // — can't be staged from outside the module without exposing
  // `_doFetchPublicStreamBySlug` or the cache maps as test seams, and
  // the audit's `no-source-mod` rule precludes that. The guard is
  // referenced from the file-level `// Guards:` comment instead so a
  // future maintainer trying to delete it triggers reviewer attention.
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
    ({ getPublicStreamBySlug } = await import(
      "@/backend/api/platforms/kick/endpoints/stream-endpoints"
    ));
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

    expect(platformHealthSpies.recordPlatformFailure).toHaveBeenCalledWith(
      "kick",
      "server-5xx",
    );
    expect(platformHealthSpies.recordPlatformSuccess).toHaveBeenCalledWith("kick");
  });
});
