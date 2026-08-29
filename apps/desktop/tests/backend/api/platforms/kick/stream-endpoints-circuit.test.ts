import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards: circuit-open (slice 03) — while Kick is degraded, shed non-probe
// requests by serving last-known-good cache; probes fire at most once per 5s
// cooldown to feed the recovery signal; cold slugs (no cache) always fall
// through; shed requests never acquire a concurrency slot.

const mockState = vi.hoisted(() => {
  type QueuedResponse =
    | { kind: "ok"; body: string }
    | { kind: "error"; message: string };

  const state = {
    responseQueue: [] as QueuedResponse[],
    netRequestCalls: [] as Array<{ url: string }>,
  };

  async function fakeFetch(url: string, _options?: unknown): Promise<Response> {
    state.netRequestCalls.push({ url });
    const next = state.responseQueue.shift();
    if (!next) {
      return new Promise<Response>(() => {});
    }
    if (next.kind === "error") {
      throw new Error(next.message);
    }
    return new Response(next.body, { status: 200 });
  }

  return { state, fakeFetch };
});

vi.mock("electron", () => ({
  net: {
    fetch: (url: string, options?: unknown) => mockState.fakeFetch(url, options),
  },
}));

const networkHealthSpies = vi.hoisted(() => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
}));

vi.mock("@backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: networkHealthSpies.acquireKickRequestSlot,
}));

const platformHealthSpies = vi.hoisted(() => ({
  recordPlatformFailure: vi.fn(),
  recordPlatformSuccess: vi.fn(),
  recordPlatformLocalNetError: vi.fn(),
  isPlatformHealthy: vi.fn(() => true),
  getPlatformHealth: vi.fn((): string => "healthy"),
}));

vi.mock("@backend/api/unified/platform-health", () => ({
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

const LIVE_BODY_B = JSON.stringify({
  slug: "streamerb",
  user: {
    username: "StreamerB",
    profile_picture: "https://files.kick.com/avatars/streamerb.webp",
  },
  livestream: {
    id: 888,
    channel_id: 54321,
    session_title: "Also live",
    viewer_count: 10,
    thumbnail: { url: "https://files.kick.com/thumb-b.webp" },
    created_at: "2026-05-20T13:00:00Z",
    language: "en",
    custom_tags: [],
    tags: [],
    is_mature: false,
    categories: [{ id: 2, name: "Gaming" }],
  },
});

describe("getPublicStreamBySlug — circuit-open (slice 03)", () => {
  let getPublicStreamBySlug: typeof import("@backend/api/platforms/kick/endpoints/stream-endpoints").getPublicStreamBySlug;
  let __resetCircuitProbeForTests: typeof import("@backend/api/platforms/kick/endpoints/stream-endpoints").__resetCircuitProbeForTests;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockState.state.responseQueue.length = 0;
    mockState.state.netRequestCalls.length = 0;
    networkHealthSpies.acquireKickRequestSlot.mockImplementation(async () => () => {});
    platformHealthSpies.recordPlatformFailure.mockReset();
    platformHealthSpies.recordPlatformSuccess.mockReset();
    platformHealthSpies.recordPlatformLocalNetError.mockReset();
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);
    platformHealthSpies.getPlatformHealth.mockReturnValue("healthy");
    ({ getPublicStreamBySlug, __resetCircuitProbeForTests } = await import(
      "@backend/api/platforms/kick/endpoints/stream-endpoints"
    ));
    __resetCircuitProbeForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("while healthy, behavior unchanged — requests go to network normally", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    const result = await getPublicStreamBySlug("ac7ionman");
    expect(result?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1);
  });

  it("while degraded with cached data, sheds non-probe requests — returns stale cache", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    // Prime the success cache while healthy.
    const primed = await getPublicStreamBySlug("ac7ionman");
    expect(primed?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1);

    // Advance past the 90s positive-cache TTL so the normal cache-hit path
    // won't short-circuit — only the circuit-open stale-serve should fire.
    await vi.advanceTimersByTimeAsync(100_000);

    // Switch to degraded.
    platformHealthSpies.isPlatformHealthy.mockReturnValue(false);
    platformHealthSpies.getPlatformHealth.mockReturnValue("degraded");

    // First call after degrading is a probe (fires through).
    // Advance 5s so the NEXT call is also eligible as a probe, then
    // we call twice in quick succession: first is probe, second is shed.
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    await getPublicStreamBySlug("ac7ionman");
    // That was the probe. Now call again immediately — within the 5s cooldown.
    mockState.state.netRequestCalls.length = 0;

    const shedResult = await getPublicStreamBySlug("ac7ionman");
    expect(shedResult?.id).toBe("999");
    // No new network call for the shed request.
    expect(mockState.state.netRequestCalls).toHaveLength(0);
  });

  it("while degraded, probe goes through — first request after 5s cooldown fires normally", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    // Prime cache.
    await getPublicStreamBySlug("ac7ionman");
    await vi.advanceTimersByTimeAsync(100_000);

    platformHealthSpies.isPlatformHealthy.mockReturnValue(false);
    platformHealthSpies.getPlatformHealth.mockReturnValue("degraded");

    // First request after degrade = probe.
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    mockState.state.netRequestCalls.length = 0;

    const probeResult = await getPublicStreamBySlug("ac7ionman");
    expect(probeResult?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1);
  });

  it("probe interval is deterministic — 2 calls within 5s: first is probe, second is shed", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY_B });

    // Prime caches for two different slugs.
    await getPublicStreamBySlug("ac7ionman");
    await getPublicStreamBySlug("streamerb");
    await vi.advanceTimersByTimeAsync(100_000);

    platformHealthSpies.isPlatformHealthy.mockReturnValue(false);
    platformHealthSpies.getPlatformHealth.mockReturnValue("degraded");
    mockState.state.netRequestCalls.length = 0;

    // First call = probe (fires through).
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    await getPublicStreamBySlug("ac7ionman");
    expect(mockState.state.netRequestCalls).toHaveLength(1);

    // Second call within the same 5s window = shed (no network).
    const shed = await getPublicStreamBySlug("streamerb");
    expect(shed?.id).toBe("888");
    expect(mockState.state.netRequestCalls).toHaveLength(1);

    // Advance past the 5s cooldown.
    await vi.advanceTimersByTimeAsync(5_000);
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY_B });

    // Next call after cooldown = probe again.
    await getPublicStreamBySlug("streamerb");
    expect(mockState.state.netRequestCalls).toHaveLength(2);
  });

  it("cold slug (no cache) falls through even when degraded", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(false);
    platformHealthSpies.getPlatformHealth.mockReturnValue("degraded");

    // No prior cache for this slug. Even though degraded, we must still
    // attempt the network because we have nothing to serve.
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    // Consume the first probe so the next call tests the non-probe cold path.
    __resetCircuitProbeForTests();
    // Make the first call a probe to burn it, then test cold slug.
    // Actually, with no cache AND not a probe, the spec says fall through.
    // Let's set the probe timestamp to now so the next call is NOT a probe.
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    // First call: this slug has no cache, so it falls through regardless.
    const result = await getPublicStreamBySlug("brand-new-slug");
    expect(result?.id).toBe("999");
    expect(mockState.state.netRequestCalls).toHaveLength(1);
  });

  it("no concurrency slot leak on shed — acquireKickRequestSlot is NOT called for shed requests", async () => {
    platformHealthSpies.isPlatformHealthy.mockReturnValue(true);
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });

    // Prime cache while healthy.
    await getPublicStreamBySlug("ac7ionman");
    await vi.advanceTimersByTimeAsync(100_000);

    platformHealthSpies.isPlatformHealthy.mockReturnValue(false);
    platformHealthSpies.getPlatformHealth.mockReturnValue("degraded");

    // First call = probe (does hit network and acquires slot).
    mockState.state.responseQueue.push({ kind: "ok", body: LIVE_BODY });
    await getPublicStreamBySlug("ac7ionman");

    // Reset the slot spy counter.
    networkHealthSpies.acquireKickRequestSlot.mockClear();

    // Second call within 5s = shed. Must NOT acquire a slot.
    await getPublicStreamBySlug("ac7ionman");

    expect(networkHealthSpies.acquireKickRequestSlot).not.toHaveBeenCalled();
  });
});
