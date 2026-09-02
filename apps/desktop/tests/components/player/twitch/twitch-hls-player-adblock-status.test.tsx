import { render } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdBlockStatus } from "@shared/adblock-types";
import { DEFAULT_USER_PREFERENCES, type TwitchPlaylistProxyPreferences } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  mockSubscribeAdBlockStatus,
  mockSetStatusChangeCallback,
  mockUpdateAdBlockConfig,
  sourceLoadVideoStates,
  synchronousManifestState,
} = vi.hoisted(() => ({
  hlsConstructorConfigs: [] as Array<Record<string, unknown>>,
  hlsInstances: [] as Array<{
    emit: (event: string, data?: unknown) => void;
    destroy: ReturnType<typeof vi.fn>;
    loadSource: ReturnType<typeof vi.fn>;
    startLoad: ReturnType<typeof vi.fn>;
    stopLoad: ReturnType<typeof vi.fn>;
    detachMedia: ReturnType<typeof vi.fn>;
    levels: Array<Record<string, unknown>>;
    currentLevel: number;
  }>,
  playerCallbackState: {
    reload: null as null | ((reason?: string) => void),
    pauseResume: null as null | (() => void),
  },
  statusCallbackState: {
    callback: null as null | ((status: AdBlockStatus) => void),
  },
  mockClearStreamInfo: vi.fn((_channelName: string) => {}),
  mockGetAdBlockConfig: vi.fn(() => ({ backupPlayerTypes: [] })),
  mockGetAdBlockHlsConfig: vi.fn((_channelName: string) => ({})),
  mockGetAdBlockStatus: vi.fn<(channelName: string) => AdBlockStatus>((channelName: string) => ({
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
  mockSetPlayerCallbacks: vi.fn(
    (
      channelOrReload: string | ((reason?: string) => void),
      reloadOrPauseResume: (reason?: string) => void,
      pauseResume?: () => void
    ) => {
      const reload = typeof channelOrReload === "string" ? reloadOrPauseResume : channelOrReload;
      playerCallbackState.reload = reload;
      playerCallbackState.pauseResume =
        typeof channelOrReload === "string"
          ? (pauseResume ?? null)
          : (reloadOrPauseResume as () => void);
      return () => {
        if (playerCallbackState.reload === reload) playerCallbackState.reload = null;
        playerCallbackState.pauseResume = null;
      };
    }
  ),
  mockSubscribeAdBlockStatus: vi.fn(
    (_channelName: string, callback: (status: AdBlockStatus) => void) => {
      statusCallbackState.callback = callback;
      return vi.fn();
    }
  ),
  mockSetStatusChangeCallback: vi.fn((callback: (status: AdBlockStatus) => void) => {
    statusCallbackState.callback = callback;
  }),
  mockUpdateAdBlockConfig: vi.fn((_updates: unknown) => {}),
  sourceLoadVideoStates: [] as Array<{ muted: boolean; volume: number }>,
  synchronousManifestState: {
    levels: null as Array<Record<string, unknown>> | null,
  },
}));

vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported() {
      return true;
    }

    static Events = {
      MANIFEST_PARSED: "hlsManifestParsed",
      LEVEL_SWITCHED: "hlsLevelSwitched",
      LEVEL_LOADED: "hlsLevelLoaded",
      ERROR: "hlsError",
      MEDIA_ATTACHED: "hlsMediaAttached",
      FRAG_LOADED: "hlsFragLoaded",
      FRAG_BUFFERED: "hlsFragBuffered",
      BUFFER_FLUSHING: "hlsBufferFlushing",
    };

    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    static ErrorDetails = { MANIFEST_LOAD_ERROR: "manifestLoadError" };

    config = { backBufferLength: 30 };
    levels: Array<Record<string, unknown>> = [];
    currentLevel = -1;
    loadSource = vi.fn(() => {
      const video = document.querySelector("video");
      if (video) {
        sourceLoadVideoStates.push({ muted: video.muted, volume: video.volume });
      }
      if (!synchronousManifestState.levels) return;
      this.levels = synchronousManifestState.levels;
      this.emit(FakeHls.Events.MANIFEST_PARSED, { levels: this.levels });
      this.emit(FakeHls.Events.LEVEL_SWITCHED, { level: this.currentLevel });
    });
    attachMedia = vi.fn();
    off = vi.fn();
    destroy = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    detachMedia = vi.fn();
    recoverMediaError = vi.fn();
    trigger = vi.fn();
    eventHandlers = new Map<string, Array<(event: string, data?: unknown) => void>>();

    constructor(config?: Record<string, unknown>) {
      hlsConstructorConfigs.push(config ?? {});
      hlsInstances.push(this);
    }

    emit(event: string, data?: unknown) {
      const eventData = data ?? { levels: this.levels };
      this.eventHandlers.get(event)?.forEach((handler) => handler(event, eventData));
    }

    on(event: string, handler: (event: string, data?: unknown) => void) {
      const handlers = this.eventHandlers.get(event) ?? [];
      handlers.push(handler);
      this.eventHandlers.set(event, handlers);
    }
  }

  return { default: FakeHls };
});

vi.mock("@/features/playback/components/player/twitch/twitch-adblock-loader", () => ({
  getAdBlockHlsConfig: (channelName: string) => mockGetAdBlockHlsConfig(channelName),
}));

vi.mock("@/features/playback/components/player/twitch/twitch-adblock-service", () => ({
  clearStreamInfo: (channelName: string) => mockClearStreamInfo(channelName),
  getAdBlockConfig: () => mockGetAdBlockConfig(),
  getAdBlockStatus: (channelName: string) => mockGetAdBlockStatus(channelName),
  initAdBlockService: (config: unknown) => mockInitAdBlockService(config),
  isAdBlockEnabled: () => mockIsAdBlockEnabled(),
  setAuthHeaders: (deviceId: string) => mockSetAuthHeaders(deviceId),
  setPlayerCallbacks: (...args: [string | (() => void), () => void, (() => void)?]) =>
    mockSetPlayerCallbacks(args[0], args[1], args[2]),
  subscribeAdBlockStatus: (channelName: string, callback: (status: AdBlockStatus) => void) =>
    mockSubscribeAdBlockStatus(channelName, callback),
  setStatusChangeCallback: (callback: (status: AdBlockStatus) => void) =>
    mockSetStatusChangeCallback(callback),
  updateAdBlockConfig: (updates: unknown) => mockUpdateAdBlockConfig(updates),
}));

import { TwitchHlsPlayer } from "@/features/playback/components/player/twitch/twitch-hls-player";

// Guards: Twitch players publish adblock status during startup so controls can render the shield before any ad playlist event arrives.
// Guards: Twitch live playback uses the stability-first default HLS buffer config so random CDN jitter is less likely to stall playback.
// Guards: fragment watchdog stalls get one local HLS restart, then request a fresh source instead of spinning forever.
// Guards: Twitch Highest applies explicit Source during manifest parsing before adblock backup selection can pin a lower level.
// Guards: ad backup and recovery manifests recompute Highest instead of retaining a stale numeric level.
// Guards: Twitch controls receive the actual HLS level after adblock-driven switches.
// Guards: late dock quality authority applies against an already-parsed Twitch manifest once, while mini and return preserve the session.
// Guards: unsafe Twitch ad fallback shields video pixels and audio synchronously before the processed playlist is released.
// Guards: preliminary ad detection shields immediately so a pending backup cannot expose a Twitch commercial-break interstitial.
// Guards: a clean aligned backup stays visible and audible without a blank-video substitution.
// Guards: source and route changes retain the shield until a fragment from the new safe playlist is actually presented.
// Guards: recovery ignores stale ad fragments, accepts any buffered member of the safe playlist, and defers clean status until reveal.
// Guards: the persistent no-black cover is released only when the exact verified clean replacement frame is presented.
// Guards: the persistent cover receives a synchronous pre-shield signal before the unsafe video is hidden.
// Guards: ad-block player callbacks never pause or resume media; playback state remains user-owned.
// Guards: a stalled ad hold retries HLS locally and never requests an external refresh/remount.
// Guards: changing explicit playback intent never rebuilds HLS, and late autoplay work respects a deliberate pause.
// Guards: playlist-proxy mode never initializes custom adblock loaders and advances only after terminal playlist HTTP failures.
// Guards: Twitch manifest 403 is a refreshable token failure and never pauses media itself.
// Guards: verified clean presentation restores the exact user mute preference after internal ad-audio suppression.
// Guards: repeated ad-start recovery signals never stop/restart a verified clean HLS feed or disturb media progression.
// Guards: rapid clean-to-unsafe re-entry invalidates a pending clean-frame callback before it can uncover unsafe media.
describe("TwitchHlsPlayer adblock status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hlsConstructorConfigs.length = 0;
    hlsInstances.length = 0;
    playerCallbackState.reload = null;
    statusCallbackState.callback = null;
    sourceLoadVideoStates.length = 0;
    synchronousManifestState.levels = null;
    localStorage.clear();
    mockIsAdBlockEnabled.mockReturnValue(true);
    mockGetAdBlockStatus.mockImplementation((channelName: string) => ({
      isActive: true,
      isShowingAd: false,
      isMidroll: false,
      isStrippingSegments: false,
      numStrippedSegments: 0,
      activePlayerType: null,
      channelName,
      isUsingFallbackMode: false,
      adStartTime: null,
    }));
    vi.useRealTimers();
    useAuthStore.setState({ preferences: null });
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

  it("uses playlist sources before direct Twitch and suppresses custom adblock", () => {
    const twitchPlaylistProxy: TwitchPlaylistProxyPreferences = {
      enabled: true,
      sources: [
        {
          id: "first",
          url: "https://proxy.example/live/$channel",
          enabled: true,
          addQueryParams: true,
        },
      ],
    };
    useAuthStore.setState({
      preferences: { ...DEFAULT_USER_PREFERENCES, twitchPlaylistProxy },
    });

    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
      />
    );

    expect(mockInitAdBlockService).not.toHaveBeenCalled();
    expect(hlsInstances[0].loadSource).toHaveBeenCalledWith(
      "https://proxy.example/live/sodapoppin?allow_source=true&allow_audio_only=true&fast_bread=true"
    );

    act(() => {
      hlsInstances[0].emit("hlsError", {
        type: "networkError",
        details: "manifestLoadError",
        fatal: true,
        response: { code: 503 },
      });
    });

    expect(hlsInstances[1].loadSource).toHaveBeenCalledWith(
      "https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
    );
  });

  it("shields an unsafe ad status that is already active when the player mounts", () => {
    mockGetAdBlockStatus.mockReturnValue({
      isActive: true,
      isShowingAd: true,
      isMidroll: true,
      isStrippingSegments: true,
      numStrippedSegments: 1,
      activePlayerType: null,
      channelName: "sodapoppin",
      isUsingFallbackMode: true,
      adStartTime: Date.now(),
    });

    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const video = container.querySelector("video");

    expect(video?.style.opacity).toBe("0");
    expect(video?.muted).toBe(true);
  });

  it("synchronously shields video and audio when unsafe ad fallback starts", () => {
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    video.muted = false;

    act(() => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: false,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: true,
        adStartTime: Date.now(),
      });
    });

    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);
  });

  it("signals the persistent cover before mutating video opacity", () => {
    let opacityAtSignal: string | null = null;
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
        onBeforeAdPresentationShield={() => {
          opacityAtSignal = container.querySelector("video")?.style.opacity ?? null;
        }}
      />
    );

    act(() => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: true,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: true,
        adStartTime: Date.now(),
      });
    });

    expect(opacityAtSignal).toBe("");
    expect(container.querySelector("video")?.style.opacity).toBe("0");
  });

  it("shields immediately while ad fallback selection is still pending", () => {
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    act(() => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: false,
        isStrippingSegments: false,
        numStrippedSegments: 0,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: false,
        adStartTime: Date.now(),
      });
    });

    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);
  });

  it("does not shield this player for another channel's ad status", () => {
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    act(() => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: false,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "another-channel",
        isUsingFallbackMode: true,
        adStartTime: Date.now(),
      });
    });

    expect(video.style.opacity).toBe("");
    expect(video.muted).toBe(false);
  });

  it("restores the persistent video when ad blocking is disabled while shielded", () => {
    const rendered = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const video = rendered.container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    act(() => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: true,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: true,
        adStartTime: Date.now(),
      });
    });
    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);

    rendered.rerender(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock={false}
      />
    );

    expect(rendered.container.querySelector("video")).toBe(video);
    expect(video.style.opacity).toBe("");
    expect(video.muted).toBe(false);
  });

  it("keeps the persistent video shielded across source and channel route changes", () => {
    const rendered = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8?token=one"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const video = rendered.container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const shield = () => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: true,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: true,
        adStartTime: Date.now(),
      });
    };

    act(shield);
    rendered.rerender(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8?token=two"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);

    const refreshedHls = hlsInstances[1];
    const heartbeatCallbackCount = frameCallbacks.length;
    act(() => {
      refreshedHls.emit("hlsLevelLoaded", {
        details: {
          fragments: [
            {
              sn: 501,
              url: "https://video-weaver.redacted.ttvnw.net/clean-501.ts",
              start: 100,
            },
          ],
        },
      });
      refreshedHls.emit("hlsFragBuffered", {
        frag: {
          sn: 499,
          url: "https://video-weaver.redacted.ttvnw.net/stale-ad-499.ts",
        },
      });
    });
    expect(frameCallbacks).toHaveLength(heartbeatCallbackCount);
    expect(video.style.opacity).toBe("0");

    act(() => {
      refreshedHls.emit("hlsFragBuffered", {
        frag: {
          sn: 501,
          url: "https://video-weaver.redacted.ttvnw.net/clean-501.ts",
        },
      });
      const callbacksToRun = frameCallbacks.splice(0, frameCallbacks.length);
      callbacksToRun.forEach((callback) =>
        callback(0, { mediaTime: 100 } as VideoFrameCallbackMetadata)
      );
    });
    expect(video.style.opacity).toBe("");
    expect(video.muted).toBe(false);

    act(shield);
    rendered.rerender(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/moonmoon.m3u8?token=one"
        channelName="moonmoon"
        muted={false}
        enableAdBlock
      />
    );
    expect(rendered.container.querySelector("video")).toBe(video);
    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);

    const routedHls = hlsInstances[2];
    act(() => {
      routedHls.emit("hlsLevelLoaded", {
        details: {
          fragments: [
            {
              sn: 601,
              url: "https://video-weaver.redacted.ttvnw.net/clean-601.ts",
              start: 120,
            },
          ],
        },
      });
      routedHls.emit("hlsFragBuffered", {
        frag: {
          sn: 601,
          url: "https://video-weaver.redacted.ttvnw.net/clean-601.ts",
        },
      });
      const callbacksToRun = frameCallbacks.splice(0, frameCallbacks.length);
      callbacksToRun.forEach((callback) =>
        callback(0, { mediaTime: 120 } as VideoFrameCallbackMetadata)
      );
    });
    expect(video.style.opacity).toBe("");
    expect(video.muted).toBe(false);
  });

  it("applies requested volume and mute before HLS starts loading the source", () => {
    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        volume={0.35}
        muted
        enableAdBlock
      />
    );

    expect(sourceLoadVideoStates[0]).toEqual({ muted: true, volume: 0.35 });
  });

  it("keeps a clean aligned backup visible without muting it", () => {
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    video.muted = false;

    act(() => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: false,
        isStrippingSegments: false,
        numStrippedSegments: 0,
        activePlayerType: "embed",
        channelName: "sodapoppin",
        isUsingFallbackMode: false,
        adStartTime: Date.now(),
      });
    });

    expect(video.style.opacity).toBe("");
    expect(video.muted).toBe(false);
  });

  it.each([false, true])(
    "keeps blocking published until the exact clean frame and restores muted=%s",
    (requestedMuted) => {
      const onAdBlockStatusChange = vi.fn();
      const onVerifiedCleanAdPresentation = vi.fn();
      const { container } = render(
        <TwitchHlsPlayer
          src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
          channelName="sodapoppin"
          muted={requestedMuted}
          enableAdBlock
          onAdBlockStatusChange={onAdBlockStatusChange}
          onVerifiedCleanAdPresentation={onVerifiedCleanAdPresentation}
        />
      );
      const hls = hlsInstances[0];
      const video = container.querySelector("video");
      expect(video).not.toBeNull();
      if (!video) return;

      const unsafeStatus: AdBlockStatus = {
        isActive: true,
        isShowingAd: true,
        isMidroll: true,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: true,
        adStartTime: Date.now(),
      };
      const cleanStatus: AdBlockStatus = {
        ...unsafeStatus,
        isShowingAd: false,
        isMidroll: false,
        isStrippingSegments: false,
        numStrippedSegments: 0,
        isUsingFallbackMode: false,
        adStartTime: null,
      };
      const frameCallbacks: VideoFrameRequestCallback[] = [];
      Object.defineProperty(video, "requestVideoFrameCallback", {
        configurable: true,
        value: vi.fn((callback: VideoFrameRequestCallback) => {
          frameCallbacks.push(callback);
          return frameCallbacks.length;
        }),
      });

      act(() => statusCallbackState.callback?.(unsafeStatus));
      expect(video).toHaveAttribute("data-streamfusion-ad-presentation-shielded", "true");
      act(() => statusCallbackState.callback?.(cleanStatus));
      expect(video).toHaveAttribute("data-streamfusion-ad-presentation-shielded", "true");

      expect(onAdBlockStatusChange).toHaveBeenLastCalledWith(unsafeStatus);
      expect(onVerifiedCleanAdPresentation).not.toHaveBeenCalled();

      mockGetAdBlockStatus.mockReturnValue(cleanStatus);
      act(() => {
        hls.emit("hlsLevelLoaded", {
          details: {
            fragments: [
              {
                sn: 301,
                url: "https://video-weaver.redacted.ttvnw.net/clean-301.ts",
                start: 60,
              },
            ],
          },
        });
        hls.emit("hlsFragBuffered", {
          frag: {
            sn: 301,
            url: "https://video-weaver.redacted.ttvnw.net/clean-301.ts",
          },
        });
      });

      expect(onAdBlockStatusChange).toHaveBeenLastCalledWith(unsafeStatus);
      expect(video).toHaveAttribute("data-streamfusion-ad-presentation-shielded", "true");
      act(() => {
        frameCallbacks.shift()?.(0, { mediaTime: 60 } as VideoFrameCallbackMetadata);
      });
      expect(onAdBlockStatusChange).toHaveBeenLastCalledWith(cleanStatus);
      expect(onVerifiedCleanAdPresentation).toHaveBeenCalledTimes(1);
      expect(video).not.toHaveAttribute("data-streamfusion-ad-presentation-shielded");
      expect(video.muted).toBe(requestedMuted);
    }
  );

  it("ignores a stale clean-frame callback after rapid unsafe re-entry", () => {
    const onVerifiedCleanAdPresentation = vi.fn();
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
        onVerifiedCleanAdPresentation={onVerifiedCleanAdPresentation}
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    const unsafeStatus: AdBlockStatus = {
      isActive: true,
      isShowingAd: true,
      isMidroll: true,
      isStrippingSegments: true,
      numStrippedSegments: 1,
      activePlayerType: null,
      channelName: "sodapoppin",
      isUsingFallbackMode: true,
      adStartTime: Date.now(),
    };
    const cleanStatus: AdBlockStatus = {
      ...unsafeStatus,
      isShowingAd: false,
      isMidroll: false,
      isStrippingSegments: false,
      numStrippedSegments: 0,
      isUsingFallbackMode: false,
      adStartTime: null,
    };
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });

    act(() => statusCallbackState.callback?.(unsafeStatus));
    act(() => statusCallbackState.callback?.(cleanStatus));
    mockGetAdBlockStatus.mockReturnValue(cleanStatus);
    act(() => {
      hls.emit("hlsLevelLoaded", {
        details: {
          fragments: [
            {
              sn: 701,
              url: "https://video-weaver.redacted.ttvnw.net/clean-701.ts",
              start: 140,
            },
          ],
        },
      });
      hls.emit("hlsFragBuffered", {
        frag: {
          sn: 701,
          url: "https://video-weaver.redacted.ttvnw.net/clean-701.ts",
        },
      });
    });
    const staleCleanFrame = frameCallbacks.shift();
    expect(staleCleanFrame).toBeDefined();

    act(() => statusCallbackState.callback?.(unsafeStatus));
    act(() => {
      staleCleanFrame?.(0, { mediaTime: 140 } as VideoFrameCallbackMetadata);
    });

    expect(cancelVideoFrameCallback).toHaveBeenCalled();
    expect(onVerifiedCleanAdPresentation).not.toHaveBeenCalled();
    expect(video).toHaveAttribute("data-streamfusion-ad-presentation-shielded", "true");
    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);
  });

  it("stays shielded with the blocking status when frame presentation callbacks are unavailable", () => {
    const onAdBlockStatusChange = vi.fn();
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
        onAdBlockStatusChange={onAdBlockStatusChange}
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: undefined,
    });

    const unsafeStatus: AdBlockStatus = {
      isActive: true,
      isShowingAd: true,
      isMidroll: true,
      isStrippingSegments: true,
      numStrippedSegments: 1,
      activePlayerType: null,
      channelName: "sodapoppin",
      isUsingFallbackMode: true,
      adStartTime: Date.now(),
    };
    const cleanStatus: AdBlockStatus = {
      ...unsafeStatus,
      isShowingAd: false,
      isMidroll: false,
      isStrippingSegments: false,
      numStrippedSegments: 0,
      isUsingFallbackMode: false,
      adStartTime: null,
    };

    act(() => statusCallbackState.callback?.(unsafeStatus));
    act(() => statusCallbackState.callback?.(cleanStatus));
    mockGetAdBlockStatus.mockReturnValue(cleanStatus);
    act(() => {
      hls.emit("hlsLevelLoaded", {
        details: {
          fragments: [
            {
              sn: 401,
              url: "https://video-weaver.redacted.ttvnw.net/clean-401.ts",
              start: 80,
            },
          ],
        },
      });
      hls.emit("hlsFragBuffered", {
        frag: {
          sn: 401,
          url: "https://video-weaver.redacted.ttvnw.net/clean-401.ts",
        },
      });
    });

    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);
    expect(onAdBlockStatusChange).toHaveBeenLastCalledWith(unsafeStatus);
  });

  it("reveals on the first buffered safe fragment even when an earlier safe fragment is skipped", () => {
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        muted={false}
        enableAdBlock
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;

    const frameCallbacks: VideoFrameRequestCallback[] = [];
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: requestVideoFrameCallback,
    });
    video.muted = false;
    video.currentTime = 40;

    act(() => {
      statusCallbackState.callback?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: true,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: true,
        adStartTime: Date.now(),
      });
    });
    expect(video.style.opacity).toBe("0");

    const cleanStatus: AdBlockStatus = {
      isActive: true,
      isShowingAd: false,
      isMidroll: false,
      isStrippingSegments: false,
      numStrippedSegments: 0,
      activePlayerType: null,
      channelName: "sodapoppin",
      isUsingFallbackMode: false,
      adStartTime: null,
    };
    mockGetAdBlockStatus.mockReturnValue(cleanStatus);
    act(() => {
      hls.emit("hlsLevelLoaded", {
        details: {
          fragments: [
            {
              sn: 201,
              url: "https://video-weaver.redacted.ttvnw.net/clean-201.ts",
              start: 42,
              duration: 2,
            },
            {
              sn: 202,
              url: "https://video-weaver.redacted.ttvnw.net/clean-202.ts",
              start: 44,
              duration: 2,
            },
          ],
        },
      });
    });

    act(() => {
      hls.emit("hlsFragBuffered", {
        frag: {
          sn: 200,
          url: "https://video-weaver.redacted.ttvnw.net/ad-200.ts",
          start: 40,
          duration: 2,
        },
      });
    });
    expect(requestVideoFrameCallback).not.toHaveBeenCalled();
    expect(video.style.opacity).toBe("0");

    act(() => {
      hls.emit("hlsFragBuffered", {
        frag: {
          sn: 202,
          url: "https://video-weaver.redacted.ttvnw.net/clean-202.ts",
          start: 44,
          duration: 2,
        },
      });
    });
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    expect(video.style.opacity).toBe("0");
    expect(video.muted).toBe(true);

    act(() => {
      frameCallbacks.shift()?.(0, { mediaTime: 43.9 } as VideoFrameCallbackMetadata);
    });
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    expect(video.style.opacity).toBe("0");

    act(() => {
      frameCallbacks.shift()?.(0, { mediaTime: 44 } as VideoFrameCallbackMetadata);
    });
    expect(video.style.opacity).toBe("");
    expect(video.muted).toBe(false);
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
        enableWorker: false,
        capLevelToPlayerSize: true,
        lowLatencyMode: false,
        liveSyncDurationCount: 4,
        backBufferLength: 5,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        fragLoadingMaxRetry: 4,
      })
    );
  });

  it("applies Highest to explicit Source when the Twitch manifest is parsed", () => {
    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        currentLevel="auto"
        preferredQuality="highest"
        enableAdBlock
      />
    );
    const hls = hlsInstances[0];
    const levels = [
      { width: 1920, height: 1080, bitrate: 8_000_000, name: "1080p60" },
      { width: 1280, height: 720, bitrate: 4_000_000, name: "720p60 (Source)" },
      { width: 852, height: 480, bitrate: 1_500_000, name: "480p" },
    ];
    hls.levels = levels;

    act(() => hls.emit("hlsManifestParsed", { levels }));

    expect(hls.currentLevel).toBe(1);
  });

  it("observes a manifest and active level emitted synchronously during source loading", () => {
    const onQualityLevels = vi.fn();
    const onActiveQualityChange = vi.fn();
    synchronousManifestState.levels = [
      { width: 1280, height: 720, bitrate: 4_000_000, name: "720p60" },
      { width: 1920, height: 1080, bitrate: 8_000_000, name: "1080p60 (Source)" },
    ];

    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        preferredQuality="highest"
        onQualityLevels={onQualityLevels}
        onActiveQualityChange={onActiveQualityChange}
        enableAdBlock
      />
    );

    expect(hlsInstances[0].currentLevel).toBe(1);
    expect(onQualityLevels).toHaveBeenCalledWith([
      expect.objectContaining({ id: "auto", isAuto: true }),
      expect.objectContaining({ id: "0", height: 720 }),
      expect.objectContaining({ id: "1", height: 1080, isSource: true }),
    ]);
    expect(onActiveQualityChange).toHaveBeenCalledWith("1");
  });

  it("applies late dock quality authority without remounting or resetting the session", () => {
    const { rerender } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
      />
    );
    const hls = hlsInstances[0];
    const levels = [
      { width: 1280, height: 720, bitrate: 4_000_000, name: "720p60" },
      { width: 1920, height: 1080, bitrate: 8_000_000, name: "1080p60 (Source)" },
    ];
    hls.levels = levels;
    act(() => hls.emit("hlsManifestParsed", { levels }));
    expect(hls.currentLevel).toBe(-1);

    rerender(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        preferredQuality="highest"
        enableAdBlock
      />
    );
    expect(hls.currentLevel).toBe(1);
    expect(hlsInstances).toHaveLength(1);

    hls.currentLevel = 0;
    rerender(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
      />
    );
    rerender(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        preferredQuality="highest"
        enableAdBlock
      />
    );
    expect(hls.currentLevel).toBe(0);
    expect(hlsInstances).toHaveLength(1);
  });

  it("reapplies Highest across ad backup and recovery manifests", () => {
    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        currentLevel="auto"
        preferredQuality="highest"
        enableAdBlock
      />
    );
    const hls = hlsInstances[0];
    const initial = [
      { width: 1280, height: 720, bitrate: 3_000_000, name: "720p60" },
      { width: 1920, height: 1080, bitrate: 6_000_000, name: "1080p60 (Source)" },
    ];
    const adBackup = [
      { width: 1280, height: 720, bitrate: 3_000_000, name: "720p60" },
      { width: 640, height: 360, bitrate: 800_000, name: "360p" },
    ];
    const recovered = [
      { width: 852, height: 480, bitrate: 1_500_000, name: "480p" },
      { width: 1920, height: 1080, bitrate: 6_000_000, name: "1080p60 (Source)" },
    ];

    act(() => hls.emit("hlsManifestParsed", { levels: initial }));
    expect(hls.currentLevel).toBe(1);
    act(() => hls.emit("hlsManifestParsed", { levels: adBackup }));
    expect(hls.currentLevel).toBe(0);
    act(() => hls.emit("hlsManifestParsed", { levels: recovered }));
    expect(hls.currentLevel).toBe(1);
  });

  it("publishes the actual Twitch HLS level after a switch", () => {
    const onActiveQualityChange = vi.fn();
    render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        onActiveQualityChange={onActiveQualityChange}
        enableAdBlock
      />
    );

    act(() => hlsInstances[0].emit("hlsLevelSwitched", { level: 2 }));

    expect(onActiveQualityChange).toHaveBeenCalledWith("2");
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

  it("reports a manifest 403 as token refresh without pausing media", () => {
    const onError = vi.fn();
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
        enableAdBlock
        onError={onError}
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});

    act(() => {
      hlsInstances[0].emit("hlsError", {
        details: "manifestLoadError",
        fatal: true,
        response: { code: 403 },
        type: "networkError",
      });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "TOKEN_EXPIRED", fatal: true, shouldRefresh: true })
    );
    expect(pause).not.toHaveBeenCalled();
  });

  it("runs one bounded recovery ladder when live fragments remain stalled", () => {
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
      vi.advanceTimersByTime(25_499);
    });
    expect(hls.startLoad).toHaveBeenCalledTimes(2);
    expect(hls.startLoad).toHaveBeenLastCalledWith(-1);
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PLAYBACK_STALL", shouldRefresh: true })
    );
    expect(hls.destroy).toHaveBeenCalledTimes(1);
  });

  it("bounds the startup spinner when fragments never arrive", () => {
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
      vi.advanceTimersByTime(24_999);
    });
    expect(hls.startLoad).toHaveBeenCalledTimes(2);
    expect(hls.startLoad).toHaveBeenLastCalledWith(-1);
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NO_FRAGMENTS", shouldRefresh: true })
    );
    expect(hls.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps a stale unsafe ad hold inside local HLS recovery without refreshing playback", () => {
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
      vi.advanceTimersByTime(14_999);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(hls.startLoad).toHaveBeenCalledWith(-1);
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(hls.startLoad).toHaveBeenCalledTimes(2);
    expect(hls.startLoad).toHaveBeenLastCalledWith(-1);
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(hls.startLoad).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();
  });

  it("does not refresh during a long ad hold while fragments keep progressing", () => {
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
        isMidroll: true,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "sodapoppin",
        isUsingFallbackMode: false,
        adStartTime: Date.now(),
      });
    });

    for (let index = 0; index < 8; index += 1) {
      act(() => {
        vi.advanceTimersByTime(2_500);
        hls.emit("hlsFragLoaded");
      });
    }

    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(hls.destroy).not.toHaveBeenCalled();
  });

  it("restores preferred quality without restarting when ad-block reports an ad ended", () => {
    vi.useFakeTimers();

    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        preferredQuality="highest"
        enableAdBlock
      />
    );
    const hls = hlsInstances[0];
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    Object.defineProperty(video, "paused", { value: false, configurable: true });

    const levels = [
      { width: 852, height: 480, bitrate: 1_500_000, name: "480p" },
      { width: 1920, height: 1080, bitrate: 6_000_000, name: "1080p60 (Source)" },
    ];
    hls.levels = levels;
    act(() => hls.emit("hlsManifestParsed", { levels }));
    expect(hls.currentLevel).toBe(1);
    hls.currentLevel = 0;
    hls.loadSource.mockClear();
    hls.startLoad.mockClear();

    act(() => playerCallbackState.reload?.("ad-ended"));
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.currentLevel).toBe(1);
    expect(hls.loadSource).not.toHaveBeenCalled();
  });

  it("keeps a verified clean feed continuous across repeated ad-start signals", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
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
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    video.currentTime = 100;
    const waiting = vi.fn();
    video.addEventListener("waiting", waiting);
    hls.loadSource.mockClear();
    hls.stopLoad.mockClear();
    hls.startLoad.mockClear();

    act(() => {
      playerCallbackState.reload?.("ad-started");
      playerCallbackState.reload?.("ad-started");
      playerCallbackState.reload?.("ad-started");
    });

    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.loadSource).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(100);
    expect(waiting).not.toHaveBeenCalled();
  });

  it("does not register an ad-owned callback that changes the user's paused state", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const { container } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
      />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    if (!video) return;
    Object.defineProperty(video, "paused", { configurable: true, value: false });

    act(() => playerCallbackState.pauseResume?.());

    expect(pause).not.toHaveBeenCalled();
    expect(video.paused).toBe(false);
  });

  it("reports a clean presented frame and cancels its frame heartbeat on teardown", () => {
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      frameCallbacks.push(callback);
      return 73;
    });
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: requestVideoFrameCallback,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    const onCleanPresentedFrame = vi.fn();
    const onHlsInstance = vi.fn();

    const { unmount } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        enableAdBlock
        onCleanPresentedFrame={onCleanPresentedFrame}
        onHlsInstance={onHlsInstance}
      />
    );
    const hls = hlsInstances[0];
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);

    act(() => {
      frameCallbacks.shift()?.(0, { mediaTime: 12 } as VideoFrameCallbackMetadata);
    });
    expect(onCleanPresentedFrame).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(73);
    expect(hls.stopLoad).toHaveBeenCalled();
    expect(hls.detachMedia).toHaveBeenCalled();
    expect(hls.destroy).toHaveBeenCalledTimes(1);
    expect(onHlsInstance).toHaveBeenLastCalledWith(null);

    delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback;
    delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).cancelVideoFrameCallback;
  });

  it("keeps the HLS session intact and cancels late autoplay when intent changes to paused", () => {
    vi.useFakeTimers();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const rendered = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
        enableAdBlock
      />
    );
    const hls = hlsInstances[0];

    rendered.rerender(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay={false}
        enableAdBlock
      />
    );

    expect(hlsInstances).toHaveLength(1);
    expect(hls.destroy).not.toHaveBeenCalled();

    act(() => {
      hls.emit("hlsManifestParsed", { levels: [] });
      vi.runOnlyPendingTimers();
    });
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it("cancels pending autoplay work when the source unmounts", () => {
    vi.useFakeTimers();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { unmount } = render(
      <TwitchHlsPlayer
        src="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
        enableAdBlock
      />
    );

    act(() => hlsInstances[0].emit("hlsManifestParsed", { levels: [] }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(vi.getTimerCount()).toBe(0);
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });
});
