import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderResponse } from "hls.js";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { mockSuperLoad } = vi.hoisted(() => {
  const mockSuperLoad = vi.fn();
  return { mockSuperLoad };
});

vi.mock("hls.js", () => {
  class DefaultLoader {
    abort() {}
    destroy() {}
    load(..._args: unknown[]) {}
    context: unknown = null;
    stats: unknown = {};
  }
  DefaultLoader.prototype.load = mockSuperLoad;

  const FakeHls = {
    isSupported: () => true,
    DefaultConfig: { loader: DefaultLoader },
  };
  return { default: FakeHls };
});

import {
  createKickClipPlaylistLoader,
  isKickClipPlaylistUrl,
} from "@/features/playback/components/player/kick/kick-clip-loader";

type KickLoader = InstanceType<ReturnType<typeof createKickClipPlaylistLoader>>;
type KickContext = Parameters<KickLoader["load"]>[0];

function makeCallbacks(onSuccess = vi.fn()): LoaderCallbacks<KickContext> {
  return { onSuccess, onError: vi.fn(), onTimeout: vi.fn(), onProgress: vi.fn() };
}

function invokeWrappedOnSuccess(loader: KickLoader, context: KickContext, response: LoaderResponse) {
  loader.load(context, {} as LoaderConfiguration, makeCallbacks());

  const loadCall = mockSuperLoad.mock.calls[mockSuperLoad.mock.calls.length - 1];
  const passedCallbacks = loadCall[2];
  const wrappedOnSuccess = passedCallbacks.onSuccess;

  const originalOnSuccess = vi.fn();
  wrappedOnSuccess(response, {}, context, null);
  return { wrappedOnSuccess, passedCallbacks };
}

// Guards: Kick clip HLS URLs get the clip-only playlist workaround while other playback URLs pass through.
describe("isKickClipPlaylistUrl", () => {
  it("returns false for null/undefined", () => {
    expect(isKickClipPlaylistUrl(null)).toBe(false);
    expect(isKickClipPlaylistUrl(undefined)).toBe(false);
    expect(isKickClipPlaylistUrl("")).toBe(false);
  });

  it("returns false for non-m3u8 URLs", () => {
    expect(isKickClipPlaylistUrl("https://kick.com/clip/abc")).toBe(false);
    expect(isKickClipPlaylistUrl("https://kick.com/clips/abc.mp4")).toBe(false);
  });

  it("returns false for non-Kick URLs", () => {
    expect(isKickClipPlaylistUrl("https://twitch.tv/clip/abc.m3u8")).toBe(false);
    expect(isKickClipPlaylistUrl("https://example.com/clips/abc.m3u8")).toBe(false);
  });

  it("returns false for Kick non-clip URLs", () => {
    expect(isKickClipPlaylistUrl("https://kick.com/stream/abc.m3u8")).toBe(false);
    expect(isKickClipPlaylistUrl("https://kick.com/vod/abc.m3u8")).toBe(false);
  });

  it("returns true for Kick clip URLs with .m3u8", () => {
    expect(isKickClipPlaylistUrl("https://kick.com/clip/abc.m3u8")).toBe(true);
    expect(isKickClipPlaylistUrl("https://kick.com/clips/abc/playlist.m3u8")).toBe(true);
    expect(isKickClipPlaylistUrl("https://cdn.kick.com/clip/123/video.m3u8")).toBe(true);
  });

  it("is case-insensitive for domain and path", () => {
    expect(isKickClipPlaylistUrl("https://KICK.COM/CLIP/abc.m3u8")).toBe(true);
    expect(isKickClipPlaylistUrl("https://Kick.Com/Clips/abc.m3u8")).toBe(true);
  });
});

// Guards: Kick clip media playlists must skip the first bad segment and avoid Electron cache failures on remaining segment requests.
describe("createKickClipPlaylistLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a loader constructor", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    expect(typeof LoaderClass).toBe("function");
  });

  it("passes through non-m3u8 requests directly to super.load", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const context = { url: "https://kick.com/clip/segment.ts" } as KickContext;
    const callbacks = makeCallbacks();

    loader.load(context, {} as LoaderConfiguration, callbacks);

    expect(mockSuperLoad).toHaveBeenCalled();
    const passedCallbacks = mockSuperLoad.mock.calls[0][2];
    expect(passedCallbacks.onSuccess).toBe(callbacks.onSuccess);
  });

  it("wraps onSuccess for m3u8 requests before calling super.load", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/abc.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    expect(mockSuperLoad).toHaveBeenCalled();
    const passedCallbacks = mockSuperLoad.mock.calls[0][2];
    expect(passedCallbacks.onSuccess).not.toBe(originalOnSuccess);
  });

  it("drops first segment from media playlist", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/abc.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    const passedCallbacks = mockSuperLoad.mock.calls[0][2];

    const mediaPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4.000,
https://cdn.kick.com/clip/seg-0.ts
#EXTINF:4.000,
https://cdn.kick.com/clip/seg-1.ts
#EXTINF:4.000,
https://cdn.kick.com/clip/seg-2.ts
#EXT-X-ENDLIST`;

    passedCallbacks.onSuccess({ data: mediaPlaylist }, {}, context, null);

    const passedData = originalOnSuccess.mock.calls[0][0].data as string;
    expect(passedData).not.toContain("seg-0.ts");
    expect(passedData).toContain("seg-1.ts");
    expect(passedData).toContain("seg-2.ts");
  });

  it("adds cache busting to remaining media segment URLs", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/abc.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    const passedCallbacks = mockSuperLoad.mock.calls[0][2];

    const mediaPlaylist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4.000,
https://clips.kick.com/clips/abc/seg-0.ts
#EXTINF:4.000,
https://clips.kick.com/clips/abc/seg-1.ts
#EXTINF:4.000,
5533.ts?token=abc#frag
#EXT-X-ENDLIST`;

    passedCallbacks.onSuccess({ data: mediaPlaylist }, {}, context, null);

    const passedData = originalOnSuccess.mock.calls[0][0].data as string;
    expect(passedData).not.toContain("seg-0.ts");
    expect(passedData).toContain("https://clips.kick.com/clips/abc/seg-1.ts?sf_clip_nocache=1");
    expect(passedData).toContain("5533.ts?token=abc&sf_clip_nocache=1#frag");
  });

  it("bumps EXT-X-MEDIA-SEQUENCE when dropping first segment", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/abc.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    const passedCallbacks = mockSuperLoad.mock.calls[0][2];

    const playlist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:5
#EXTINF:4.000,
https://cdn.kick.com/clip/seg-5.ts
#EXTINF:4.000,
https://cdn.kick.com/clip/seg-6.ts`;

    passedCallbacks.onSuccess({ data: playlist }, {}, context, null);

    const passedData = originalOnSuccess.mock.calls[0][0].data as string;
    expect(passedData).toContain("#EXT-X-MEDIA-SEQUENCE:6");
    expect(passedData).not.toContain("seg-5.ts");
    expect(passedData).toContain("seg-6.ts");
  });

  it("passes through master playlists unchanged (no EXTINF)", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/master.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    const passedCallbacks = mockSuperLoad.mock.calls[0][2];

    const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
https://cdn.kick.com/clip/1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
https://cdn.kick.com/clip/720p.m3u8`;

    passedCallbacks.onSuccess({ data: masterPlaylist }, {}, context, null);

    const passedData = originalOnSuccess.mock.calls[0][0].data as string;
    expect(passedData).toBe(masterPlaylist);
  });

  it("passes through non-string response data", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/abc.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    const passedCallbacks = mockSuperLoad.mock.calls[0][2];

    const binaryResponse = { data: new ArrayBuffer(10) };
    passedCallbacks.onSuccess(binaryResponse, {}, context, null);

    expect(originalOnSuccess).toHaveBeenCalledWith(binaryResponse, {}, context, null);
  });

  it("handles playlist rewrite error gracefully", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/abc.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    const passedCallbacks = mockSuperLoad.mock.calls[0][2];

    const badResponse = {
      get data(): string {
        throw new Error("data access error");
      },
    };

    passedCallbacks.onSuccess(badResponse, {}, context, null);

    expect(originalOnSuccess).toHaveBeenCalled();
  });

  it("handles per-segment tags between EXTINF and URI", () => {
    const LoaderClass = createKickClipPlaylistLoader();
    const loader = new LoaderClass({} as HlsConfig);

    const originalOnSuccess = vi.fn();
    const context = { url: "https://kick.com/clip/abc.m3u8" } as KickContext;
    const callbacks = makeCallbacks(originalOnSuccess);

    loader.load(context, {} as LoaderConfiguration, callbacks);

    const passedCallbacks = mockSuperLoad.mock.calls[0][2];

    const playlist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4.000,
#EXT-X-BYTERANGE:1000@0
https://cdn.kick.com/clip/seg-0.ts
#EXTINF:4.000,
https://cdn.kick.com/clip/seg-1.ts`;

    passedCallbacks.onSuccess({ data: playlist }, {}, context, null);

    const passedData = originalOnSuccess.mock.calls[0][0].data as string;
    expect(passedData).not.toContain("seg-0.ts");
    expect(passedData).not.toContain("BYTERANGE");
    expect(passedData).toContain("seg-1.ts");
    expect(passedData).toContain("#EXT-X-MEDIA-SEQUENCE:1");
  });
});
