import { describe, expect, it, vi } from "vitest";

import {
  buildDevMediaProxyUrl,
  handleDevMediaProxyRequest,
  rewriteDevMediaPlaylist,
  validateDevMediaTarget,
} from "@/backend/dev-relay/dev-media-proxy";

// Guards: development media relay accepts observed Twitch/Kick CDN URLs without becoming an SSRF proxy
// Guards: proxied HLS playlists keep every nested playlist, key, map, and segment on the authenticated relay
// Guards: an allowed browser media request returns a rewritten HLS response instead of leaking direct CDN requests
// Guards: hostile Range headers cannot turn one browser request into an unbounded upstream download
// Guards: an allowed CDN cannot redirect the development proxy into loopback or another untrusted host
// Guards: an upstream response cannot make the development relay buffer or stream an unbounded payload
describe("development media proxy", () => {
  it("accepts only HTTPS URLs on the explicit public media CDN allowlist", () => {
    expect(
      validateDevMediaTarget(
        "https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/channel/index.m3u8"
      )
    ).toEqual(new URL("https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/channel/index.m3u8"));
    expect(
      validateDevMediaTarget("https://fa723fc1b171.use21.playlist.live-video.net/v1/index.m3u8")
    ).toEqual(new URL("https://fa723fc1b171.use21.playlist.live-video.net/v1/index.m3u8"));
    expect(validateDevMediaTarget("https://files.kick.com/images/channel/avatar.webp")).toEqual(
      new URL("https://files.kick.com/images/channel/avatar.webp")
    );

    expect(validateDevMediaTarget("http://usher.ttvnw.net/api/channel/hls/test.m3u8")).toBeNull();
    expect(validateDevMediaTarget("https://127.0.0.1/secret")).toBeNull();
    expect(validateDevMediaTarget("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(validateDevMediaTarget("https://files.kick.com.attacker.test/avatar.webp")).toBeNull();
    expect(validateDevMediaTarget("https://attacker.test/video.m3u8")).toBeNull();
  });

  it("resolves and rewrites every nested HLS resource through the same-origin proxy", () => {
    const source =
      "https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/channel/master.m3u8?token=secret";
    const playlist = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin"',
      '#EXT-X-MAP:URI="init.mp4"',
      "#EXT-X-STREAM-INF:BANDWIDTH=2500000",
      "720p/index.m3u8",
      "#EXTINF:4.0,",
      "segment-1.ts?part=1",
      "#EXT-X-TWITCH-PREFETCH:https://d2vjef5jvl6bfs.cloudfront.net/segment-2.ts",
      "",
    ].join("\n");

    expect(rewriteDevMediaPlaylist(playlist, source)).toBe(
      [
        "#EXTM3U",
        `#EXT-X-KEY:METHOD=AES-128,URI="${buildDevMediaProxyUrl(
          "https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/keys/key.bin"
        )}"`,
        `#EXT-X-MAP:URI="${buildDevMediaProxyUrl(
          "https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/channel/init.mp4"
        )}"`,
        "#EXT-X-STREAM-INF:BANDWIDTH=2500000",
        buildDevMediaProxyUrl(
          "https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/channel/720p/index.m3u8"
        ),
        "#EXTINF:4.0,",
        buildDevMediaProxyUrl(
          "https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/channel/segment-1.ts?part=1"
        ),
        `#EXT-X-TWITCH-PREFETCH:${buildDevMediaProxyUrl(
          "https://d2vjef5jvl6bfs.cloudfront.net/segment-2.ts"
        )}`,
        "",
      ].join("\n")
    );
  });

  it("fetches an allowed HLS target and returns its rewritten playlist", async () => {
    const upstreamUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8?token=secret";
    const request = new Request(`http://127.0.0.1${buildDevMediaProxyUrl(upstreamUrl)}`);
    const fetchUpstream = vi.fn().mockResolvedValue(
      new Response("#EXTM3U\nchunked/index.m3u8\n", {
        headers: { "Content-Type": "application/vnd.apple.mpegurl" },
      })
    );

    const response = await handleDevMediaProxyRequest(request, fetchUpstream);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.apple.mpegurl");
    expect(await response.text()).toBe(
      `#EXTM3U\n${buildDevMediaProxyUrl(
        "https://usher.ttvnw.net/api/channel/hls/chunked/index.m3u8"
      )}\n`
    );
  });

  it("rejects oversized or multipart byte ranges before contacting the CDN", async () => {
    const upstreamUrl = "https://clips-media-assets2.twitch.tv/example.mp4";
    const fetchUpstream = vi.fn();

    const oversized = await handleDevMediaProxyRequest(
      new Request(`http://127.0.0.1${buildDevMediaProxyUrl(upstreamUrl)}`, {
        headers: { Range: "bytes=0-33554432" },
      }),
      fetchUpstream
    );
    const multipart = await handleDevMediaProxyRequest(
      new Request(`http://127.0.0.1${buildDevMediaProxyUrl(upstreamUrl)}`, {
        headers: { Range: "bytes=0-10,20-30" },
      }),
      fetchUpstream
    );

    expect(oversized.status).toBe(416);
    expect(multipart.status).toBe(416);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it("rejects an upstream redirect whose destination is outside the CDN allowlist", async () => {
    const upstreamUrl = "https://usher.ttvnw.net/api/channel/hls/test.m3u8";
    const fetchUpstream = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/internal" },
      })
    );

    const response = await handleDevMediaProxyRequest(
      new Request(`http://127.0.0.1${buildDevMediaProxyUrl(upstreamUrl)}`),
      fetchUpstream
    );

    expect(response.status).toBe(400);
    expect(fetchUpstream).toHaveBeenCalledOnce();
  });

  it("rejects a media response whose declared size exceeds the relay limit", async () => {
    const upstreamUrl = "https://clips-media-assets2.twitch.tv/example.mp4";
    const fetchUpstream = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: {
          "Content-Length": String(64 * 1024 * 1024 + 1),
          "Content-Type": "video/mp4",
        },
      })
    );

    const response = await handleDevMediaProxyRequest(
      new Request(`http://127.0.0.1${buildDevMediaProxyUrl(upstreamUrl)}`),
      fetchUpstream
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
