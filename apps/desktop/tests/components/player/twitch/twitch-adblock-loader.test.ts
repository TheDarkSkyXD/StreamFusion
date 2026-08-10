import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  mockIsAdBlockEnabled,
  mockIsAdSegment,
  mockGetBlankVideoDataUrl,
  mockProcessMasterPlaylist,
  mockProcessMediaPlaylist,
  mockSuperLoad,
} = vi.hoisted(() => ({
  mockIsAdBlockEnabled: vi.fn<() => boolean>(() => true),
  mockIsAdSegment: vi.fn<(url: string) => boolean>(() => false),
  mockGetBlankVideoDataUrl: vi.fn<() => string>(() => "data:video/mp4;base64,AAAA"),
  mockProcessMasterPlaylist: vi.fn<
    (url: string, text: string, channel: string, playlistBaseUrl?: string) => Promise<string>
  >(async (_url: string, text: string) => text),
  mockProcessMediaPlaylist: vi.fn<
    (url: string, text: string, channelName?: string) => Promise<string>
  >(
    async (_url: string, text: string, _channelName?: string) => text
  ),
  mockSuperLoad: vi.fn(),
}));

vi.mock("@/components/player/twitch/twitch-adblock-service", () => ({
  isAdBlockEnabled: () => mockIsAdBlockEnabled(),
  isAdSegment: (url: string) => mockIsAdSegment(url),
  getBlankVideoDataUrl: () => mockGetBlankVideoDataUrl(),
  processMasterPlaylist: (url: string, text: string, channel: string, playlistBaseUrl?: string) =>
    mockProcessMasterPlaylist(url, text, channel, playlistBaseUrl),
  processMediaPlaylist: (url: string, text: string, channelName?: string) =>
    mockProcessMediaPlaylist(url, text, channelName),
}));

vi.mock("hls.js", () => {
  class DefaultLoader {
    abort() {}
    destroy() {}
    load(..._args: unknown[]) {}
    context: any = null;
    stats: any = {};
  }
  DefaultLoader.prototype.load = mockSuperLoad;

  class FakeHls {
    static isSupported() {
      return true;
    }
    static DefaultConfig = { loader: DefaultLoader };
    static Events = {
      MANIFEST_PARSED: "hlsManifestParsed",
      ERROR: "hlsError",
    };
  }
  return { default: FakeHls };
});

import {
  createAdBlockFragmentLoader,
  createAdBlockPlaylistLoader,
  getAdBlockHlsConfig,
} from "@/components/player/twitch/twitch-adblock-loader";

// Guards: playlist-processing failures fail closed and never release the unprocessed Twitch response to HLS.
describe("twitch-adblock-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAdBlockEnabled.mockReturnValue(true);
    mockIsAdSegment.mockReturnValue(false);
  });

  describe("createAdBlockPlaylistLoader", () => {
    it("returns a loader constructor", () => {
      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      expect(LoaderClass).toBeDefined();
      expect(typeof LoaderClass).toBe("function");
    });

    it("creates a loader instance", () => {
      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);
      expect(loader).toBeDefined();
      expect(typeof loader.load).toBe("function");
    });

    it("passes through non-m3u8 requests directly", () => {
      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const context = { url: "https://example.com/segment.ts" } as any;
      const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);
      expect(mockSuperLoad).toHaveBeenCalled();
    });

    it("passes through when ad-blocking is disabled", () => {
      mockIsAdBlockEnabled.mockReturnValue(false);
      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = { url: "https://usher.ttvnw.net/api/channel/hls/test.m3u8?token=abc" } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);
      expect(mockSuperLoad).toHaveBeenCalled();
      // onSuccess should NOT have been wrapped since adblock is disabled
      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      expect(passedCallbacks.onSuccess).toBe(originalOnSuccess);
    });

    it("wraps onSuccess for m3u8 requests when enabled", () => {
      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = { url: "https://usher.ttvnw.net/api/channel/hls/test.m3u8?token=abc" } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      expect(passedCallbacks.onSuccess).not.toBe(originalOnSuccess);
    });

    it("processes master playlist through adblock service on success", async () => {
      mockProcessMasterPlaylist.mockResolvedValue("processed-master");

      const LoaderClass = createAdBlockPlaylistLoader();
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = {
        url: "https://usher.ttvnw.net/api/channel/hls/mychannel.m3u8?token=abc",
      } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const wrappedOnSuccess = passedCallbacks.onSuccess;
      const response = { data: "#EXTM3U\n#EXT-X-STREAM-INF..." };

      await wrappedOnSuccess(response, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalled();
      expect(originalOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ data: "processed-master" }),
        {},
        context,
        null
      );
    });

    it("processes current Twitch /api/channel master playlist URLs", async () => {
      mockProcessMasterPlaylist.mockResolvedValue("processed-master");

      const LoaderClass = createAdBlockPlaylistLoader();
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = {
        url: "https://usher.ttvnw.net/api/channel/jamiepinelive.m3u8?token=abc",
      } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess({ data: "#EXTM3U" }, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U",
        "jamiepinelive",
        context.url
      );
      expect(mockProcessMediaPlaylist).not.toHaveBeenCalled();
      expect(originalOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ data: "processed-master" }),
        {},
        context,
        null
      );
    });

    it("processes media playlist through adblock service on success", async () => {
      mockProcessMediaPlaylist.mockResolvedValue("processed-media");

      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = {
        url: "https://video-edge.example.com/playlist/1080p.m3u8?token=abc",
      } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const wrappedOnSuccess = passedCallbacks.onSuccess;
      const response = { data: "#EXTM3U\n#EXTINF..." };

      await wrappedOnSuccess(response, {}, context, null);

      expect(mockProcessMediaPlaylist).toHaveBeenCalled();
      expect(originalOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ data: "processed-media" }),
        {},
        context,
        null
      );
    });

    it("uses the final HLS response URL as the playlist ownership identity", async () => {
      const LoaderClass = createAdBlockPlaylistLoader("fixtureproof");
      const loader = new LoaderClass({} as any);
      const context = {
        url: "http://localhost:5173/proof/video-edge.ttvnw.net/high.m3u8",
      } as any;
      const callbacks = {
        onSuccess: vi.fn(),
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);
      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const responseUrl = "http://127.0.0.1:18765/proof/video-edge.ttvnw.net/high.m3u8";
      await passedCallbacks.onSuccess(
        { data: "#EXTM3U\n#EXTINF:2,live", url: responseUrl },
        {},
        context,
        null
      );

      expect(mockProcessMediaPlaylist).toHaveBeenCalledWith(
        responseUrl,
        "#EXTM3U\n#EXTINF:2,live",
        "fixtureproof"
      );
    });

    it("ignores a non-HTTP response URL when the request context has a valid HTTPS playlist URL", async () => {
      const LoaderClass = createAdBlockPlaylistLoader("fixtureproof");
      const loader = new LoaderClass({} as any);
      const context = {
        url: "https://video-edge.ttvnw.net/proof/high.m3u8",
      } as any;
      const callbacks = {
        onSuccess: vi.fn(),
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);
      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess(
        { data: "#EXTM3U\n#EXTINF:2,live", url: "ftp://untrusted.invalid/proof/high.m3u8" },
        {},
        context,
        null
      );

      expect(mockProcessMediaPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U\n#EXTINF:2,live",
        "fixtureproof"
      );
    });

    it("fails explicitly when a text master playlist has no absolute HTTP base URL", async () => {
      const LoaderClass = createAdBlockPlaylistLoader("fixtureproof");
      const loader = new LoaderClass({} as any);
      const originalOnSuccess = vi.fn();
      const onError = vi.fn();
      const context = {
        url: "/__streamfusion-proof/twitch-ad-frame/adframe-20260803-r6/usher.ttvnw.net/api/channel/hls/fixtureproof.m3u8",
      } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError,
        onTimeout: vi.fn(),
      } as any;
      const stats = { loaded: 123 } as any;
      const networkDetails = { status: 200 };

      loader.load(context, {} as any, callbacks);
      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess({ data: "#EXTM3U" }, stats, context, networkDetails);

      expect.soft(onError).toHaveBeenCalledTimes(1);
      expect.soft(onError).toHaveBeenCalledWith(
        {
          code: 0,
          text: "Twitch ad-block playlist processing requires an absolute HTTP(S) base URL",
        },
        context,
        networkDetails,
        stats
      );
      expect.soft(originalOnSuccess).not.toHaveBeenCalled();
      expect.soft(mockProcessMasterPlaylist).not.toHaveBeenCalled();
      expect.soft(mockProcessMediaPlaylist).not.toHaveBeenCalled();
    });

    it("uses the final master response URL as the rendition resolution base", async () => {
      const LoaderClass = createAdBlockPlaylistLoader("fixtureproof");
      const loader = new LoaderClass({} as any);
      const context = {
        url: "http://localhost:5173/proof/usher.ttvnw.net/api/channel/hls/fixtureproof.m3u8",
      } as any;
      const callbacks = {
        onSuccess: vi.fn(),
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);
      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const responseUrl =
        "http://127.0.0.1:18765/proof/usher.ttvnw.net/api/channel/hls/fixtureproof.m3u8";
      await passedCallbacks.onSuccess({ data: "#EXTM3U", url: responseUrl }, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U",
        "fixtureproof",
        responseUrl
      );
    });

    it("passes through non-string response data", async () => {
      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = { url: "https://example.com/playlist.m3u8" } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const binaryResponse = { data: new ArrayBuffer(10) };

      await passedCallbacks.onSuccess(binaryResponse, {}, context, null);

      expect(originalOnSuccess).toHaveBeenCalledWith(binaryResponse, {}, context, null);
    });

    it("fails closed instead of releasing the original response on processing error", async () => {
      mockProcessMediaPlaylist.mockRejectedValue(new Error("processing failed"));

      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const originalOnError = vi.fn();
      const context = { url: "https://video-edge.example.com/playlist.m3u8" } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: originalOnError,
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const response = { data: "#EXTM3U\n#EXTINF..." };

      const stats = { loaded: 321 };
      await passedCallbacks.onSuccess(response, stats, context, null);

      expect(originalOnSuccess).not.toHaveBeenCalled();
      expect(originalOnError).toHaveBeenCalledWith(
        { code: 0, text: "Twitch ad-block playlist processing failed closed" },
        context,
        null,
        stats
      );
    });

    it("extracts channel name from usher URL when not provided", async () => {
      mockProcessMasterPlaylist.mockResolvedValue("processed");

      const LoaderClass = createAdBlockPlaylistLoader();
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = {
        url: "https://usher.ttvnw.net/api/channel/hls/extracted_channel.m3u8?token=abc",
      } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess({ data: "#EXTM3U" }, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U",
        "extracted_channel",
        context.url
      );
    });

    it("extracts channel name from current usher URL shape when not provided", async () => {
      mockProcessMasterPlaylist.mockResolvedValue("processed");

      const LoaderClass = createAdBlockPlaylistLoader();
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = {
        url: "https://usher.ttvnw.net/api/channel/JamiePineLive.m3u8?token=abc",
      } as any;
      const callbacks = {
        onSuccess: originalOnSuccess,
        onError: vi.fn(),
        onTimeout: vi.fn(),
      } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess({ data: "#EXTM3U" }, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U",
        "jamiepinelive",
        context.url
      );
    });
  });

  describe("createAdBlockFragmentLoader", () => {
    it("returns a loader constructor", () => {
      const LoaderClass = createAdBlockFragmentLoader();
      expect(typeof LoaderClass).toBe("function");
    });

    it("passes through normal segments", () => {
      const LoaderClass = createAdBlockFragmentLoader();
      const loader = new LoaderClass({} as any);

      const context = { url: "https://video-edge.ttvnw.net/segment.ts" } as any;
      const callbacks = { onSuccess: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      expect(mockSuperLoad).toHaveBeenCalled();
      const passedContext = mockSuperLoad.mock.calls[0][0];
      expect(passedContext.url).toBe("https://video-edge.ttvnw.net/segment.ts");
    });

    it("never replaces marked ad segments with synthetic blank video", () => {
      mockIsAdSegment.mockReturnValue(true);

      const LoaderClass = createAdBlockFragmentLoader();
      const loader = new LoaderClass({} as any);

      const context = { url: "https://video-edge.ttvnw.net/ad-segment.ts" } as any;
      const callbacks = { onSuccess: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      expect(mockSuperLoad).toHaveBeenCalled();
      const passedContext = mockSuperLoad.mock.calls[0][0];
      expect(passedContext.url).toBe("https://video-edge.ttvnw.net/ad-segment.ts");
      expect(mockGetBlankVideoDataUrl).not.toHaveBeenCalled();
    });

    it("does not replace segments when ad-blocking is disabled", () => {
      mockIsAdBlockEnabled.mockReturnValue(false);
      mockIsAdSegment.mockReturnValue(true);

      const LoaderClass = createAdBlockFragmentLoader();
      const loader = new LoaderClass({} as any);

      const context = { url: "https://video-edge.ttvnw.net/ad-segment.ts" } as any;
      const callbacks = { onSuccess: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedContext = mockSuperLoad.mock.calls[0][0];
      expect(passedContext.url).toBe("https://video-edge.ttvnw.net/ad-segment.ts");
    });

    it("does not replace non-Twitch segments even if marked as ad", () => {
      mockIsAdSegment.mockReturnValue(true);

      const LoaderClass = createAdBlockFragmentLoader();
      const loader = new LoaderClass({} as any);

      const context = { url: "https://other-cdn.com/segment.mp4" } as any;
      const callbacks = { onSuccess: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedContext = mockSuperLoad.mock.calls[0][0];
      expect(passedContext.url).toBe("https://other-cdn.com/segment.mp4");
    });
  });

  describe("getAdBlockHlsConfig", () => {
    it("returns pLoader and fLoader", () => {
      const config = getAdBlockHlsConfig("testchannel");
      expect(config.pLoader).toBeDefined();
      expect(config.fLoader).toBeDefined();
      expect(typeof config.pLoader).toBe("function");
      expect(typeof config.fLoader).toBe("function");
    });
  });
});
