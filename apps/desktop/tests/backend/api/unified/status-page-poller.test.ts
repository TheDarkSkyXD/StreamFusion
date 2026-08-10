import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

type HealthEvent = { platform: string; status: string; startedAt: number };
const listeners = new Set<(event: HealthEvent) => void>();

vi.mock("@/backend/api/unified/platform-health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/api/unified/platform-health")>();
  return {
    ...actual,
    onPlatformHealthChanged: vi.fn((listener: (event: HealthEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    recordStatusPageSignal: vi.fn(),
  };
});

type LoggerMock = { debug: Mock; info: Mock; warn: Mock; error: Mock };

function fireEvent(event: HealthEvent) {
  for (const listener of listeners) listener(event);
}

function defaultKickStatusResponse(url: string | URL | Request): Response {
  const href = String(url);
  if (href.includes("/api/services")) {
    return new Response(JSON.stringify({ services: [{ name: "Other", status: "Operational" }] }), {
      status: 200,
    });
  }
  return new Response(JSON.stringify({}), { status: 200 });
}

// Guards: Kick status-page incidents tied only to Other/catch-all stay all-clear so the global outage banner only follows main system-status services.
// Guards: a successful HTML response from Kick's JSON endpoint fails closed without warning spam or dependent requests, then backs off before retrying.
describe("status-page-poller (slice 08)", () => {
  let originalFetch: typeof globalThis.fetch;
  let platformHealth: typeof import("@/backend/api/unified/platform-health");
  let loggerMock: LoggerMock;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00Z"));
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => Promise.resolve(defaultKickStatusResponse(url)));
    listeners.clear();
    platformHealth = await import("@/backend/api/unified/platform-health");
    vi.mocked(platformHealth.recordStatusPageSignal).mockClear();
    const loggerModule = (await import("@/backend/logging/logger")) as unknown as {
      logger: LoggerMock;
    };
    loggerMock = loggerModule.logger;
    loggerMock.debug.mockClear();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    const { __resetStatusPagePollerForTests, initStatusPagePoller } =
      await import("@/backend/api/unified/status-page-poller");
    __resetStatusPagePollerForTests();
    initStatusPagePoller();
    await vi.advanceTimersByTimeAsync(1);
    vi.mocked(globalThis.fetch).mockClear();
    vi.mocked(platformHealth.recordStatusPageSignal).mockClear();
    loggerMock.warn.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("starts Kick polling while platform is healthy, but does not poll Twitch", async () => {
    await vi.advanceTimersByTimeAsync(120_000);

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("https://status.kick.com/"))).toBe(true);
  });

  it("starts polling on healthy-to-degraded transition", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 })
    );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("stops Twitch polling on degraded-to-healthy transition", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 })
    );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    fireEvent({ platform: "twitch", status: "healthy", startedAt: Date.now() });

    vi.mocked(globalThis.fetch).mockClear();
    await vi.advanceTimersByTimeAsync(120_000);

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(urls.every((url) => !url.startsWith("https://status.twitch.com/"))).toBe(true);
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

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith(
      "twitch",
      "confirmed-outage"
    );
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

  it("Kick: partial outage service produces 'confirmed-outage'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ services: [{ name: "Platform", status: "Partial outage" }] }), {
        status: 200,
      })
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith(
      "kick",
      "confirmed-outage",
      expect.objectContaining({
        summary: "Kick status: Partial outage.",
        impact: "Partial outage",
      })
    );
  });

  it("Kick: PagerDuty posts + service IDs produce simple system-status detail and ignore HTML body", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            services: [
              {
                id: "PLATFORM",
                name: "Platform",
                display_name: "Platform",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            posts: [
              {
                post_type: "incident",
                latest_update: {
                  status_id: "PSU2YIK",
                  impacts: [{ service_id: "PLATFORM", severity_id: "PCAUUKL" }],
                  message:
                    "<p>KICK is currently experiencing a degraded performance. We are aware of this and looking into it.</p>",
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            post_enums: [
              {
                id: "PSU2YIK",
                name: "investigating",
                post_enum_type: "status",
              },
              {
                id: "PCAUUKL",
                name: "partial outage",
                post_enum_type: "impacts",
              },
            ],
          }),
          { status: 200 }
        )
      );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith(
      "kick",
      "confirmed-outage",
      expect.objectContaining({
        summary: "Kick status: Partial outage.",
        impact: "Partial outage",
      })
    );
    expect(platformHealth.recordStatusPageSignal).not.toHaveBeenCalledWith(
      "kick",
      "confirmed-outage",
      expect.objectContaining({
        summary: expect.stringContaining("<p>"),
      })
    );
  });

  it("Kick: PagerDuty posts affecting only Other produce 'all-clear'", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            services: [
              {
                id: "P3CL6N4",
                name: "KICK - Catch All",
                display_name: "Other",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            posts: [
              {
                post_type: "incident",
                latest_update: {
                  status_id: "PSU2YIK",
                  impacts: [{ service_id: "P3CL6N4", severity_id: "PCAUUKL" }],
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            post_enums: [
              {
                id: "PSU2YIK",
                name: "investigating",
                post_enum_type: "status",
              },
              {
                id: "PCAUUKL",
                name: "partial outage",
                post_enum_type: "impacts",
              },
            ],
          }),
          { status: 200 }
        )
      );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "all-clear");
  });

  it("Kick: direct Other service outage produces 'all-clear'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ services: [{ name: "KICK - Other", status: "Partial outage" }] }),
        { status: 200 }
      )
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "all-clear");
  });

  it("Kick: Data Services outage produces 'confirmed-outage'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ services: [{ name: "Data Services", status: "Partial outage" }] }),
        { status: 200 }
      )
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith(
      "kick",
      "confirmed-outage",
      expect.objectContaining({
        summary: "Kick status: Partial outage.",
        impact: "Partial outage",
      })
    );
  });

  it("Kick: major outage service wording is forwarded as status-page detail", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ services: [{ name: "Platform", status: "Major outage" }] }), {
        status: 200,
      })
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith(
      "kick",
      "confirmed-outage",
      expect.objectContaining({
        summary: "Kick status: Major outage.",
        impact: "Major outage",
      })
    );
  });

  it("Kick: operational services produce 'all-clear'", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ services: [{ name: "Other", status: "Operational" }] }), {
        status: 200,
      })
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "all-clear");
  });

  it("fetch failure produces 'no-signal' (never throws)", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("network error"));

    await vi.advanceTimersByTimeAsync(60_000);

    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "no-signal");
  });

  it("Kick: HTML from the services endpoint fails closed and backs off without warning spam", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("<!doctype html><html><body>Status page</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(["https://status.kick.com/api/services"]);
    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "no-signal");
    expect(platformHealth.recordStatusPageSignal).not.toHaveBeenCalledWith(
      "kick",
      "confirmed-outage",
      expect.anything()
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("Twitch status fetch rejection: logs warn with [poller-r9c2] tag and status URL in meta", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("net::ERR_TIMED_OUT"));

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [tag, message, meta] = loggerMock.warn.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(tag).toBe("StatusPoller");
    expect(message).toContain("[poller-r9c2]");
    expect(meta.url).toBe("https://status.twitch.com/api/v2/status.json");
    expect(typeof meta.err).toBe("string");
    expect((meta.err as string).length).toBeGreaterThan(0);
    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("twitch", "no-signal");
  });

  it("Twitch incidents fetch rejection: logs warn with the incidents URL in meta", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: { indicator: "major" } }), { status: 200 })
      )
      .mockRejectedValueOnce(new Error("incidents unreachable"));

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [tag, message, meta] = loggerMock.warn.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(tag).toBe("StatusPoller");
    expect(message).toContain("[poller-r9c2]");
    expect(meta.url).toBe("https://status.twitch.com/api/v2/incidents.json");
    expect(typeof meta.err).toBe("string");
    expect((meta.err as string).length).toBeGreaterThan(0);
    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("twitch", "no-signal");
  });

  it("Kick status fetch rejection: logs warn with the Kick URL in meta", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("dns failure"));

    await vi.advanceTimersByTimeAsync(60_000);

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [tag, message, meta] = loggerMock.warn.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(tag).toBe("StatusPoller");
    expect(message).toContain("[poller-r9c2]");
    expect(meta.url).toBe("https://status.kick.com/api/services");
    expect(typeof meta.err).toBe("string");
    expect((meta.err as string).length).toBeGreaterThan(0);
    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("kick", "no-signal");
  });

  it("happy path: 200 + indicator 'none' does NOT call logger.warn", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: { indicator: "none" } }), { status: 200 })
    );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);

    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("twitch", "all-clear");
  });

  it("happy path: indicator 'minor' with no API incidents does NOT call logger.warn", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: { indicator: "minor" } }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            incidents: [{ status: "investigating", components: [{ name: "Chat" }] }],
          }),
          { status: 200 }
        )
      );

    fireEvent({ platform: "twitch", status: "degraded", startedAt: Date.now() });

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(platformHealth.recordStatusPageSignal).toHaveBeenCalledWith("twitch", "all-clear");
  });

  it("poll interval is 60s", async () => {
    await vi.advanceTimersByTimeAsync(59_998);
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBeGreaterThan(0);
  });
});
