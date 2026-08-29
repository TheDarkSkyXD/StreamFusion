import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  fromPartition: vi.fn(),
  getUserAgent: vi.fn(),
}));

const networkMocks = vi.hoisted(() => ({
  acquireKickRequestSlot: vi.fn(),
  release: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock("electron", () => ({
  session: {
    fromPartition: (...args: unknown[]) => {
      electronMocks.fromPartition(...args);
      return {
        fetch: (...fetchArgs: unknown[]) => electronMocks.fetch(...fetchArgs),
        getUserAgent: () => electronMocks.getUserAgent(),
      };
    },
  },
}));

vi.mock("@backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: (...args: unknown[]) => networkMocks.acquireKickRequestSlot(...args),
}));

vi.mock("@backend/logging/logger", () => ({ logger: loggerMocks }));

import { fetchKickChannelEmotes } from "@backend/services/emotes/kick-channel-emotes-service";

let testNow = Date.now();

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Guards: normalized duplicate Kick emote requests share one transport operation and cached result.
describe("fetchKickChannelEmotes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () =>
          controller.abort(
            new DOMException("The operation was aborted due to timeout", "TimeoutError")
          ),
        milliseconds
      );
      return controller.signal;
    });
    testNow += 60 * 60 * 1_000;
    vi.setSystemTime(testNow);
    electronMocks.fetch.mockReset();
    electronMocks.fromPartition.mockReset();
    electronMocks.getUserAgent.mockReset().mockReturnValue("StreamFusion Electron/35 current-UA");
    networkMocks.release.mockReset();
    networkMocks.acquireKickRequestSlot.mockReset().mockResolvedValue(networkMocks.release);
    loggerMocks.warn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("single-flights concurrent requests for the same normalized slug", async () => {
    let resolveFetch!: (value: Response) => void;
    electronMocks.fetch.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve))
    );

    const first = fetchKickChannelEmotes("  TimMac  ");
    const duplicate = fetchKickChannelEmotes("timmac");
    await vi.advanceTimersByTimeAsync(0);

    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);

    resolveFetch(response([{ id: "set-1", emotes: [] }]));

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { emoteSets: [{ id: "set-1", emotes: [] }] },
      { emoteSets: [{ id: "set-1", emotes: [] }] },
    ]);
  });

  it("serves a successful normalized-slug result from the TTL cache", async () => {
    electronMocks.fetch.mockResolvedValueOnce(response([{ id: "set-cache", emotes: [] }]));

    const first = await fetchKickChannelEmotes("CacheCase-A");
    const cached = await fetchKickChannelEmotes(" cachecase-a ");

    expect(cached).toEqual(first);
    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);
    expect(networkMocks.acquireKickRequestSlot).toHaveBeenCalledTimes(1);
  });

  it("uses the persistent Kick session, its current user agent, and a shared request slot", async () => {
    electronMocks.fetch.mockResolvedValueOnce(response([{ id: "set-session", emotes: [{}] }]));

    await fetchKickChannelEmotes("SessionCase-B");

    expect(electronMocks.fromPartition).toHaveBeenCalledWith("persist:kick_public");
    expect(electronMocks.fetch).toHaveBeenCalledWith(
      "https://kick.com/emotes/sessioncase-b",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          "User-Agent": "StreamFusion Electron/35 current-UA",
        }),
        signal: expect.any(AbortSignal),
      })
    );
    expect(networkMocks.acquireKickRequestSlot).toHaveBeenCalledTimes(1);
    expect(networkMocks.release).toHaveBeenCalledTimes(1);
  });

  it("stops at one request and one compact warning when the primary transport times out", async () => {
    electronMocks.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })
    );

    const request = fetchKickChannelEmotes("TimeoutCase-C");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(request).resolves.toBeNull();
    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      "Emote:Kick",
      "Kick emote request failed",
      expect.objectContaining({
        slug: "timeoutcase-c",
        endpoint: "emotes",
        error: expect.objectContaining({ name: "TimeoutError" }),
      })
    );
    expect(JSON.stringify(loggerMocks.warn.mock.calls[0]?.[2])).not.toContain("stack");
  });

  it("uses the channel endpoint after a valid empty primary response", async () => {
    electronMocks.fetch
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ emotes: [{ id: 42, name: "Fallback" }] }));

    await expect(fetchKickChannelEmotes("EmptyCase-D", "access-token")).resolves.toEqual({
      channelData: { emotes: [{ id: 42, name: "Fallback" }] },
    });
    expect(electronMocks.fetch).toHaveBeenCalledTimes(2);
    expect(electronMocks.fetch).toHaveBeenLastCalledWith(
      "https://kick.com/api/v1/channels/emptycase-d",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      })
    );
  });

  it("does not cache an unexpected successful primary payload", async () => {
    electronMocks.fetch
      .mockResolvedValueOnce(response({ error: "unexpected" }))
      .mockResolvedValueOnce(response([{ id: "set-after-retry", emotes: [] }]));

    await expect(fetchKickChannelEmotes("ShapeCase-H")).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(fetchKickChannelEmotes("ShapeCase-H")).resolves.toEqual({
      emoteSets: [{ id: "set-after-retry", emotes: [] }],
    });
    expect(electronMocks.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([403, 429, 503])("does not fallback after primary HTTP %i", async (status) => {
    electronMocks.fetch.mockResolvedValueOnce(response({ error: "unavailable" }, status));

    await expect(fetchKickChannelEmotes(`StatusCase-${status}`)).resolves.toBeNull();
    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it("shares one five-second deadline across the primary and fallback requests", async () => {
    electronMocks.fetch
      .mockResolvedValueOnce(response({ error: "not found" }, 404))
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          })
      );

    const request = fetchKickChannelEmotes("DeadlineCase-E");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(request).resolves.toBeNull();
    expect(electronMocks.fetch).toHaveBeenCalledTimes(2);
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it("serves stale success after TTL expiry when the refresh transport fails", async () => {
    const stale = { emoteSets: [{ id: "stale-set", emotes: [{ id: 7 }] }] };
    electronMocks.fetch.mockResolvedValueOnce(response(stale.emoteSets));
    await expect(fetchKickChannelEmotes("StaleCase-F")).resolves.toEqual(stale);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);
    electronMocks.fetch.mockRejectedValueOnce(new TypeError("network unavailable"));

    await expect(fetchKickChannelEmotes(" stalecase-f ")).resolves.toEqual(stale);
    expect(electronMocks.fetch).toHaveBeenCalledTimes(2);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      "Emote:Kick",
      "Kick emote request failed",
      expect.objectContaining({ servedStale: true })
    );
  });

  it("cooldowns distinct slugs after a same-origin transient failure", async () => {
    electronMocks.fetch
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(response([{ id: "should-not-load", emotes: [] }]));

    await expect(fetchKickChannelEmotes("CooldownCase-G1")).resolves.toBeNull();
    await expect(fetchKickChannelEmotes("CooldownCase-G2")).resolves.toBeNull();

    expect(electronMocks.fetch).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });
});
