import { afterEach, describe, expect, it, vi } from "vitest";

import { createProtectedTwitchGateway } from "../../../adapters/twitch/protected-twitch-gateway";

const gateways: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

describe("protected Twitch gateway", () => {
  it("preserves media bytes, status, ranges, and rejects other destinations", async () => {
    const fetchUpstream = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: new Headers(init.headers).get("range") ? 206 : 200,
          headers: { "content-type": "video/mp4", "content-range": "bytes 0-2/9" },
        })
    );
    const gateway = await createProtectedTwitchGateway({
      channelSlug: "primevideo",
      masterUrl: "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv",
      customdata: "authorization",
      preferences: {},
      blockerEnabled: true,
      fetchUpstream,
    });
    gateways.push(gateway);
    const response = await fetch(
      `${gateway.baseUrl}/media?url=${encodeURIComponent("https://video-edge.ttvnw.net/v1/init.mp4")}`,
      {
        headers: { range: "bytes=0-2", origin: "https://streamfusion.test" },
      }
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/9");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(fetchUpstream).toHaveBeenCalledWith(
      "https://video-edge.ttvnw.net/v1/init.mp4",
      expect.objectContaining({ method: "GET" })
    );
    const denied = await fetch(
      `${gateway.baseUrl}/media?url=${encodeURIComponent("https://example.com/steal")}`
    );
    expect(denied.status).toBe(403);
  });

  it("sends binary CDM challenge to the fixed license endpoint and cancels on close", async () => {
    const fetchUpstream = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("customdata")).toBe("authorization");
      return new Response(new Uint8Array([7, 8, 9]));
    });
    const gateway = await createProtectedTwitchGateway({
      channelSlug: "primevideo",
      masterUrl: "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv",
      customdata: "authorization",
      preferences: {},
      blockerEnabled: true,
      fetchUpstream,
    });
    gateways.push(gateway);
    const response = await fetch(`${gateway.baseUrl}/license`, {
      method: "POST",
      headers: { origin: "https://streamfusion.test" },
      body: new Uint8Array([4, 5, 6]),
    });
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7, 8, 9]);
    expect(fetchUpstream.mock.calls[0]?.[0]).toBe(
      "https://widevine.twitch.keyos.com/api/v4/getLicense"
    );
    await gateway.close();
    await expect(fetch(`${gateway.baseUrl}/bootstrap`)).rejects.toThrow();
  });

  it("does not forward a compressed wire length for decoded playlist bytes", async () => {
    const playlist =
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://video-edge.ttvnw.net/live.m3u8\n";
    const gateway = await createProtectedTwitchGateway({
      channelSlug: "primevideo",
      masterUrl: "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv",
      customdata: "authorization",
      preferences: {},
      blockerEnabled: true,
      fetchUpstream: async () =>
        new Response(playlist, {
          headers: {
            "content-type": "application/vnd.apple.mpegurl",
            "content-encoding": "gzip",
            "content-length": "12",
          },
        }),
    });
    gateways.push(gateway);
    const response = await fetch(
      `${gateway.baseUrl}/media?url=${encodeURIComponent("https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8")}`
    );
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.text()).toBe(playlist);
  });

  it("accepts only the blocker's playback-token query and refreshes expired license authorization", async () => {
    const requests: Array<{ url: string; customdata: string | null }> = [];
    const gateway = await createProtectedTwitchGateway({
      channelSlug: "primevideo",
      masterUrl: "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv",
      customdata: "expired",
      refreshAuthorization: async () => "renewed",
      preferences: {},
      blockerEnabled: true,
      fetchUpstream: async (url, init) => {
        const customdata = new Headers(init.headers).get("customdata");
        requests.push({ url, customdata });
        if (url.includes("keyos") && customdata === "expired")
          return new Response(null, { status: 401 });
        return new Response(new Uint8Array([9, 8, 7]));
      },
    });
    gateways.push(gateway);
    const query = {
      operationName: "PlaybackAccessToken",
      variables: {
        login: "primevideo",
        playerType: "site",
        isLive: true,
        isVod: false,
        vodID: "",
        platform: "web",
      },
      extensions: { persistedQuery: { version: 1, sha256Hash: "wrong" } },
    };
    const denied = await fetch(`${gateway.baseUrl}/token`, {
      method: "POST",
      body: JSON.stringify(query),
    });
    expect(denied.status).toBe(403);
    expect(requests).toHaveLength(0);
    query.extensions.persistedQuery.sha256Hash =
      "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";
    const token = await fetch(`${gateway.baseUrl}/token`, {
      method: "POST",
      body: JSON.stringify(query),
    });
    expect(token.status).toBe(200);
    const license = await fetch(`${gateway.baseUrl}/license`, {
      method: "POST",
      body: new Uint8Array([1, 2]),
    });
    expect([...new Uint8Array(await license.arrayBuffer())]).toEqual([9, 8, 7]);
    expect(requests.map(({ customdata }) => customdata)).toEqual([null, "expired", "renewed"]);
  });

  it("preserves redirect identity and HEAD ranges while denying redirects outside media hosts", async () => {
    const fetchUpstream = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("unsafe"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/segment.mp4" },
        });
      if (init.method === "HEAD")
        return new Response(null, {
          status: 206,
          headers: { "content-range": "bytes 0-99/1000", "content-length": "100" },
        });
      return new Response(null, {
        status: 302,
        headers: { location: "https://video-edge.ttvnw.net/effective/init.mp4" },
      });
    });
    const gateway = await createProtectedTwitchGateway({
      channelSlug: "primevideo",
      masterUrl: "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv",
      customdata: "authorization",
      preferences: {},
      blockerEnabled: true,
      fetchUpstream,
    });
    gateways.push(gateway);
    const original = "https://usher.ttvnw.net/v1/init.mp4";
    const redirected = await fetch(`${gateway.baseUrl}/media?url=${encodeURIComponent(original)}`, {
      redirect: "manual",
    });
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe(
      "https://video-edge.ttvnw.net/effective/init.mp4"
    );
    expect(fetchUpstream.mock.calls[0]?.[0]).toBe(original);
    const head = await fetch(`${gateway.baseUrl}/media?url=${encodeURIComponent(original)}`, {
      method: "HEAD",
      headers: { range: "bytes=0-99" },
    });
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect(head.headers.get("content-length")).toBe("100");
    const denied = await fetch(
      `${gateway.baseUrl}/media?url=${encodeURIComponent("https://usher.ttvnw.net/unsafe.mp4")}`,
      { redirect: "manual" }
    );
    expect(denied.status).toBe(403);
  });

  it("aborts an in-flight media request when the player closes", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let upstreamSignal: AbortSignal | undefined;
    const gateway = await createProtectedTwitchGateway({
      channelSlug: "primevideo",
      masterUrl: "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv",
      customdata: "authorization",
      preferences: {},
      blockerEnabled: true,
      fetchUpstream: async (_url, init) => {
        upstreamSignal = init.signal as AbortSignal;
        markStarted();
        return new Promise<Response>((_resolve, reject) => {
          upstreamSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      },
    });
    gateways.push(gateway);
    const pending = fetch(
      `${gateway.baseUrl}/media?url=${encodeURIComponent("https://video-edge.ttvnw.net/segment.mp4")}`
    );
    await started;
    await gateway.close();
    expect(upstreamSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
  });

  it("keeps the upstream master and fMP4 playlist bytes while requesting protected backup masters", async () => {
    const playlist = new TextEncoder().encode(
      '#EXTM3U\r\n#EXT-X-MAP:URI="https://video-edge.ttvnw.net/init.mp4"\r\nhttps://video-edge.ttvnw.net/1.m4s\r\n'
    );
    const requested: string[] = [];
    const gateway = await createProtectedTwitchGateway({
      channelSlug: "primevideo",
      masterUrl: "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?cdm=wv",
      customdata: "authorization",
      preferences: {},
      blockerEnabled: true,
      fetchUpstream: async (url) => {
        requested.push(url);
        return new Response(playlist, {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      },
    });
    gateways.push(gateway);
    const backup =
      "https://usher.ttvnw.net/api/channel/hls/primevideo.m3u8?sig=backup&token=opaque";
    const response = await fetch(`${gateway.baseUrl}/media?url=${encodeURIComponent(backup)}`);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...playlist]);
    expect(requested).toEqual([`${backup}&cdm=wv`]);
  });
});
