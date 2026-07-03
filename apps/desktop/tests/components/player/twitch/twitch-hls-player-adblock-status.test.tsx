import { render } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdBlockStatus } from "@/shared/adblock-types";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  hlsConstructorConfigs,
  hlsInstances,
  playerCallbackState,
  statusCallbackState,
  mockClearStreamInfo,
  mockGetAdBlockConfig,
  mockGetAdBlockHlsConfig,
  mockGetAdBlockStatus,
  mockInitAdBlockService,
  mockIsAdBlockEnabled,
  mockSetAuthHeaders,
  mockSetPlayerCallbacks,
  mockSetStatusChangeCallback,
  mockUpdateAdBlockConfig,
} = vi.hoisted(() => ({
  hlsConstructorConfigs: [] as Array<Record<string, unknown>>,
  hlsInstances: [] as Array<{
    emit: (event: string) => void;
    destroy: ReturnType<typeof vi.fn>;
    startLoad: ReturnType<typeof vi.fn>;
    stopLoad: ReturnType<typeof vi.fn>;
  }>,
  playerCallbackState: {
    reload: null as null | ((reason?: string) => void),
  },
  statusCallbackState: {
    callback: null as null | ((status: AdBlockStatus) => void),
  },
  mockClearStreamInfo: vi.fn((_channelName: string) => {}),
  mockGetAdBlockConfig: vi.fn(() => ({ backupPlayerTypes: [] })),
  mockGetAdBlockHlsConfig: vi.fn((_channelName: string) => ({})),
  mockGetAdBlockStatus: vi.fn((channelName: string) => ({
    isActive: true,
    isShowingAd: false,
    isMidroll: false,
    isStrippingSegments: false,
    numStrippedSegments: 0,
    activePlayerType: null,
    channelName,
    isUsingFallbackMode: false,
    adStartTime: null,
  })),
  mockInitAdBlockService: vi.fn((_config: unknown) => {}),
  mockIsAdBlockEnabled: vi.fn(() => true),
  mockSetAuthHeaders: vi.fn((_deviceId: string) => {}),
  mockSetPlayerCallbacks: vi.fn((reload: (reason?: string) => void, _pauseResume: () => void) => {
    playerCallbackState.reload = reload;
  }),
  mockSetStatusChangeCallback: vi.fn((callback: (status: AdBlockStatus) => void) => {
    statusCallbackState.callback = callback;
  }),
  mockUpdateAdBlockConfig: vi.fn((_updates: unknown) => {}),
}));

vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() {
      return true;
    }

    static Events = {
      MANIFEST_PARSED: "hlsManifestParsed",
      LEVEL_SWITCHED: "hlsLevelSwitched",
      ERROR: "hlsError",
      MEDIA_ATTACHED: "hlsMediaAttached",
      FRAG_LOADED: "hlsFragLoaded",
      BUFFER_FLUSHING: "hlsBufferFlushing",
    };

    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    static ErrorDetails = { MANIFEST_LOAD_ERROR: "manifestLoadError" };

    config = { backBufferLength: 30 };
    levels = [];
    currentLevel = -1;
    loadSource = vi.fn();
    attachMedia = vi.fn();
    off = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    recoverMediaError = vi.fn();
    trigger = vi.fn();
    eventHandlers = new Map<string, Array<() => void>>();

    constructor(config?: Record<string, unknown>) {
      hlsConstructorConfigs.push(config ?? {});
      hlsInstances.push(this);
    }

    emit(event: string) {
      this.eventHandlers.get(event)?.forEach((handler) => handler());
    }

    on(event: string, handler: () => void) {
      const handlers = this.eventHandlers.get(event) ?? [];
      handlers.push(handler);
      this.eventHandlers.set(event, handlers);
    }
  }

  return { default: FakeHls };
});

vi.mock("@/components/player/twitch/twitch-adblock-loader", () => ({
  getAdBlockHlsConfig: (channelName: string) => mockGetAdBlockHlsConfig(channelName),
}));

vi.mock("@/components/player/twitch/twitch-adblock-service", () => ({
  clearStreamInfo: (channelName: string) => mockClearStreamInfo(channelName),
  getAdBlockConfig: () => mockGetAdBlockConfig(),
  getAdBlockStatus: (channelName: string) => mockGetAdBlockStatus(channelName),
  initAdBlockService: (config: unknown) => mockInitAdBlockService(config),
  isAdBlockEnabled: () => mockIsAdBlockEnabled(),
  setAuthHeaders: (deviceId: string) => mockSetAuthHeaders(deviceId),
  setPlayerCallbacks: (reload: () => void, pauseResume: () => void) =>
    mockSetPlayerCallbacks(reload, pauseResume),
  setStatusChangeCallback: (callback: (status: AdBlockStatus) => void) =>
    mockSetStatusChangeCallback(callback),
  updateAdBlockConfig: (updates: unknown) => mockUpdateAdBlockConfig(updates),
}));

import { TwitchHlsPlayer } from "@/components/player/twitch/twitch-hls-player";

// Guards: Twitch players publish adblock status during startup so controls can render the shield before any ad playlist event arrives.
// Guards: Twitch live playback uses the stability-first default HLS buffer config so random CDN jitter is less likely to stall playback.
// Guards: fragment watchdog stalls only trigger local HLS recovery, never page-visible errors or parent URL refresh; only ad-block completion can ask the parent for a fresh URL.
describe("TwitchHlsPlayer adblock status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hlsConstructorConfigs.length = 0;
    hlsInstances.length = 0;
    playerCallbackState.reload = null;
    statusCallbackState.callback = null;
    localStorage.clear();
    mockIsAdBlockEnabled.mockReturnValue(true);
    vi.useRealTimers();
  });

  it("publishes the initial active adblock status on mount", () => {
    const onAdBlockStatusChange = vi.fn();

    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
        onAdBlockStatusChange={onAdBlockStatusChange}
      />
    );

    expect(mockInitAdBlockService).toHaveBeenCalledWith({ enabled: true });
    expect(mockGetAdBlockStatus).toHaveBeenCalledWith("sodapoppin");
    expect(onAdBlockStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        isShowingAd: false,
        channelName: "sodapoppin",
      })
    );
  });

  it("publishes an inactive status when adblock is disabled", () => {
    const onAdBlockStatusChange = vi.fn();

    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock={false}
        onAdBlockStatusChange={onAdBlockStatusChange}
      />
    );

    expect(mockInitAdBlockService).not.toHaveBeenCalled();
    expect(onAdBlockStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        isShowingAd: false,
        channelName: "sodapoppin",
      })
    );
  });

  it("uses the stability-first live buffering defaults", () => {
    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
      />
    );

    expect(hlsConstructorConfigs[0]).toEqual(
      expect.objectContaining({
        lowLatencyMode: false,
        liveSyncDurationCount: 4,
        backBufferLength: 5,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        fragLoadingMaxRetry: 4,
      })
    );
  });

  it("stops live HLS loading while paused and resumes at the live edge on play", () => {
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    video.dispatchEvent(new Event("pause"));
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);

    video.dispatchEvent(new Event("play"));
    expect(hls.startLoad).toHaveBeenCalledWith(-1);
  });

  it("locally restarts HLS loading after live fragments stop arriving without reporting an error", () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
        onError={onError}
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => {
      hls.emit("hlsManifestParsed");
      hls.emit("hlsFragLoaded");
    });

    act(() => {
      vi.advanceTimersByTime(19_999);
    });
    expect(onError).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(hls.startLoad).toHaveBeenCalledWith(-1);
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();
  });

  it("locally restarts HLS loading after missing startup fragments without reporting an error", () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
        onError={onError}
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => {
      hls.emit("hlsManifestParsed");
    });

    act(() => {
      vi.advanceTimersByTime(19_999);
    });
    expect(onError).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(hls.startLoad).toHaveBeenCalledWith(-1);
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();
  });

  it("does not report missing fragments while adblock is actively holding playback", () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
        onError={onError}
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => {
      hls.emit("hlsManifestParsed");
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: false,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: false,
        adStartTime: Date.now(),
      });
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();
  });

  it("refreshes the parent playback URL immediately when ad-block reports an ad ended", () => {
    vi.useFakeTimers();
    const onAdBlockRecoveryRefresh = vi.fn();

    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
        onAdBlockRecoveryRefresh={onAdBlockRecoveryRefresh}
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => playerCallbackState.reload?.("ad-ended"));
    expect(hls.startLoad).toHaveBeenCalledWith(-1);
    expect(onAdBlockRecoveryRefresh).toHaveBeenCalledTimes(1);
  });
});
