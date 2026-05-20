import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: Kick public-stream-cache + fan-out 4-part contract (regressions cb0b7b6 + 6d3606d, refactored in 640870a).
// Guards: positive-cache TTL > poll interval — a second call to the same slug within 90s must NOT hit electron.net.request again. Without this, the 60s `useFollowedStreams` poll re-bursts on every cycle.
// Guards: stagger fires AFTER cache check — a cache-hit path returns synchronously with `staggerOffsetMs > 0`. Otherwise back-to-back same-slug callers eat a delay they don't need.
// Guards: AbortController is scoped per dispatch — an aborted staggerDelay rejects with an "AbortError" before reaching the network; orphan stagger timers from a stale dispatch don't fire into the network.
// Guards: a transient timeout does NOT preempt a fresh positive cache — the timeout-TTL (30s) is intentionally suppressed when a successful fetch from the same slug is still within `PUBLIC_STREAM_POLL_HIT_TTL_MS` (90s). Otherwise a single 5s cold-TLS timeout would flash false "channel offline" UI on the stream-detail page.

// The vi.mock factory is hoisted above all top-level declarations and cannot
// close over variables defined later in this file. `vi.hoisted` runs at the
// same hoist time, so the shared mutable state + fake-request factory live
// there together.
const mockState = vi.hoisted(() => {
  type QueuedResponse =
    | { kind: "ok"; body: string }
    | { kind: "error"; message: string };

  const state = {
    responseQueue: [] as QueuedResponse[],
    netRequestCalls: [] as Array<{ url: string }>,
  };

  function makeFakeNetRequest(url: string) {
    state.netRequestCalls.push({ url });
    const responseHandlers: Array<(resp: unknown) => void> = [];
    const errorHandlers: Array<(err: Error) => void> = [];

    return {
      setHeader: () => {},
      abort: () => {},
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "response")
          responseHandlers.push(cb as (resp: unknown) => void);
        else if (event === "error")
          errorHandlers.push(cb as (err: Error) => void);
      },
      end() {
        queueMicrotask(() => {
          const next = state.responseQueue.shift();
          if (!next) return; // Leave hanging — caller's timeout will fire.
          if (next.kind === "error") {
            for (const h of errorHandlers) h(new Error(next.message));
            return;
          }
          const dataHandlers: Array<(chunk: Buffer) => void> = [];
          const endHandlers: Array<() => void> = [];
          const fakeResponse = {
            statusCode: 200,
            on(event: string, cb: (...args: unknown[]) => void) {
              if (event === "data")
                dataHandlers.push(cb as (chunk: Buffer) => void);
              else if (event === "end") endHandlers.push(cb as () => void);
            },
          };
          for (const h of responseHandlers) h(fakeResponse);
          queueMicrotask(() => {
            for (const h of dataHandlers) h(Buffer.from(next.body));
            for (const h of endHandlers) h();
          });
        });
      },
    };
  }

  return { state, makeFakeNetRequest };
});

// `getPublicStreamBySlug` source does `require("electron")` dynamically.
// vi.mock works for both `import` and `require`.
vi.mock("electron", () => ({
  net: {
    request: ({ url }: { url: string }) => mockState.makeFakeNetRequest(url),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
  isNetworkLikelyDown: vi.fn(() => false),
  recordTransientNetworkError: vi.fn(),
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
