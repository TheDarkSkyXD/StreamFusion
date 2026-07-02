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
  mockProcessMasterPlaylist: vi.fn<(url: string, text: string, channel: string) => Promise<string>>(async (_url: string, text: string) => text),
  mockProcessMediaPlaylist: vi.fn<(url: string, text: string) => Promise<string>>(async (_url: string, text: string) => text),
  mockSuperLoad: vi.fn(),
}));

vi.mock("@/components/player/twitch/twitch-adblock-service", () => ({
  isAdBlockEnabled: () => mockIsAdBlockEnabled(),
  isAdSegment: (url: string) => mockIsAdSegment(url),
  getBlankVideoDataUrl: () => mockGetBlankVideoDataUrl(),
  processMasterPlaylist: (url: string, text: string, channel: string) =>
    mockProcessMasterPlaylist(url, text, channel),
  processMediaPlaylist: (url: string, text: string) =>
    mockProcessMediaPlaylist(url, text),
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
    static isSupported() { return true; }
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
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

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
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      expect(passedCallbacks.onSuccess).not.toBe(originalOnSuccess);
    });

    it("processes master playlist through adblock service on success", async () => {
      mockProcessMasterPlaylist.mockResolvedValue("processed-master");

      const LoaderClass = createAdBlockPlaylistLoader();
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = { url: "https://usher.ttvnw.net/api/channel/hls/mychannel.m3u8?token=abc" } as any;
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

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
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess({ data: "#EXTM3U" }, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U",
        "jamiepinelive"
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
      const context = { url: "https://video-edge.example.com/playlist/1080p.m3u8?token=abc" } as any;
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

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

    it("passes through non-string response data", async () => {
      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = { url: "https://example.com/playlist.m3u8" } as any;
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const binaryResponse = { data: new ArrayBuffer(10) };

      await passedCallbacks.onSuccess(binaryResponse, {}, context, null);

      expect(originalOnSuccess).toHaveBeenCalledWith(binaryResponse, {}, context, null);
    });

    it("falls back to original response on processing error", async () => {
      mockProcessMediaPlaylist.mockRejectedValue(new Error("processing failed"));

      const LoaderClass = createAdBlockPlaylistLoader("testchannel");
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = { url: "https://video-edge.example.com/playlist.m3u8" } as any;
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      const response = { data: "#EXTM3U\n#EXTINF..." };

      await passedCallbacks.onSuccess(response, {}, context, null);

      expect(originalOnSuccess).toHaveBeenCalledWith(response, {}, context, null);
    });

    it("extracts channel name from usher URL when not provided", async () => {
      mockProcessMasterPlaylist.mockResolvedValue("processed");

      const LoaderClass = createAdBlockPlaylistLoader();
      const loader = new LoaderClass({} as any);

      const originalOnSuccess = vi.fn();
      const context = { url: "https://usher.ttvnw.net/api/channel/hls/extracted_channel.m3u8?token=abc" } as any;
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess({ data: "#EXTM3U" }, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U",
        "extracted_channel"
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
      const callbacks = { onSuccess: originalOnSuccess, onError: vi.fn(), onTimeout: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      const passedCallbacks = mockSuperLoad.mock.calls[0][2];
      await passedCallbacks.onSuccess({ data: "#EXTM3U" }, {}, context, null);

      expect(mockProcessMasterPlaylist).toHaveBeenCalledWith(
        context.url,
        "#EXTM3U",
        "jamiepinelive"
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

    it("replaces ad segments with blank video", () => {
      mockIsAdSegment.mockReturnValue(true);

      const LoaderClass = createAdBlockFragmentLoader();
      const loader = new LoaderClass({} as any);

      const context = { url: "https://video-edge.ttvnw.net/ad-segment.ts" } as any;
      const callbacks = { onSuccess: vi.fn() } as any;

      loader.load(context, {} as any, callbacks);

      expect(mockSuperLoad).toHaveBeenCalled();
      const passedContext = mockSuperLoad.mock.calls[0][0];
      expect(passedContext.url).toBe("data:video/mp4;base64,AAAA");
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
