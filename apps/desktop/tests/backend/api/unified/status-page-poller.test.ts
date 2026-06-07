import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HealthEvent = { platform: string; status: string; startedAt: number };
const listeners = new Set<(event: HealthEvent) => void>();

vi.mock("@/backend/api/unified/platform-health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/api/unified/platform-health")>();
  return {
    ...actual,
    onPlatformHealthChanged: vi.fn((listener: (event: HealthEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
    recordStatusPageSignal: vi.fn(),
  };
});

function fireEvent(event: HealthEvent) {
  for (const listener of listeners) listener(event);
}

describe("status-page-poller (slice 08)", () => {
  let originalFetch: typeof globalThis.fetch;
  let platformHealth: typeof import("@/backend/api/unified/platform-health");

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    listeners.clear();
    platformHealth = await import("@/backend/api/unified/platform-health");
    vi.mocked(platformHealth.recordStatusPageSignal).mockClear();
    const { __resetStatusPagePollerForTests, initStatusPagePoller } = await import(
      "@/backend/api/unified/status-page-poller"
    );
    __resetStatusPagePollerForTests();
    initStatusPagePoller();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("does NOT start polling while platform is healthy", () => {
    vi.advanceTimersByTime(120_000);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("starts polling on healthy-to-degraded transition", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 })
    );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("stops polling on degraded-to-healthy transition", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 })
    );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    fireEvent({ platform: "twitch", status: "healthy", startedAt: Date.now() });

    vi.mocked(globalThis.fetch).mockClear();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("Twitch: indicator 'none' produces 'all-clear'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 })
    );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("twitch", "all-clear");
  });

  it("Twitch: indicator 'major' + API component affected produces 'confirmed-outage'", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: { indicator: "major" } }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            incidents: [
              {
                status: "investigating",
                components: [{ name: "Helix API" }],
              },
            ],
          }),
          { status: 200 }
        )
      );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("twitch", "confirmed-outage");
  });

  it("Twitch: indicator 'major' + only Chat affected produces 'all-clear'", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: { indicator: "major" } }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            incidents: [
              {
                status: "investigating",
                components: [{ name: "Chat" }],
              },
            ],
          }),
          { status: 200 }
        )
      );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("twitch", "all-clear");
  });

  it("Kick: 404 on status.json produces 'no-signal'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("Not Found", { status: 404 })
    );

    fireEvent({ platform: "kick", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "no-signal");
  });

  it("fetch failure produces 'no-signal' (never throws)", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("network error"));

    fireEvent({ platform: "kick", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "no-signal");
  });

  it("poll interval is 60s", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 })
    );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);
    const callsAfterFirstPoll = vi.mocked(globalThis.fetch).mock.calls.length;

    await vi.advanceTimersByTimeAsync(59_998);
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callsAfterFirstPoll);

    await vi.advanceTimersByTimeAsync(2);
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(callsAfterFirstPoll);
  });
});
