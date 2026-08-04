import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TWITCH_COLORS } from "@/assets/platforms/twitch";
import { KickLivePlayer } from "@/components/player/kick/kick-live-player";
import { KickVodPlayer } from "@/components/player/kick/kick-vod-player";
import { TwitchLivePlayer } from "@/components/player/twitch/twitch-live-player";
import { TwitchVodPlayer } from "@/components/player/twitch/twitch-vod-player";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_USER_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

const captionOverlayHarness = vi.hoisted(() => ({
  highlightColors: [] as Array<string | undefined>,
}));

vi.mock("@/components/player/caption-overlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/player/caption-overlay")>();
  return {
    CaptionOverlay: (props: React.ComponentProps<typeof actual.CaptionOverlay>) => {
      captionOverlayHarness.highlightColors.push(props.localHighlightColor);
      return <actual.CaptionOverlay {...props} />;
    },
  };
});

const originalUpdatePreferences = useAuthStore.getState().updatePreferences;

beforeEach(() => {
  captionOverlayHarness.highlightColors.length = 0;
  useAuthStore.setState({
    preferences: { ...DEFAULT_USER_PREFERENCES },
    updatePreferences: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  useAuthStore.setState({ preferences: null, updatePreferences: originalUpdatePreferences });
});

interface FakeEngine {
  config: {
    captionsTextTrack1LanguageCode: string;
    captionsTextTrack2LanguageCode: string;
    captionsTextTrack3LanguageCode: string;
    captionsTextTrack4LanguageCode: string;
  };
  subtitleTracks: Array<{
    name: string;
    lang?: string;
    groupId: string;
    url: string;
    default?: boolean;
  }>;
  subtitleTrack: number;
  listeners: Map<string, Set<(event: string, data: unknown) => void>>;
  on: (event: string, listener: (event: string, data: unknown) => void) => void;
  off: (event: string, listener: (event: string, data: unknown) => void) => void;
}

interface MockPlayerProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  src: string;
  currentLevel?: string;
  enableAdBlock?: boolean;
  hlsConfig?: unknown;
  isLive?: boolean;
  onAdBlockRecoveryRefresh?: () => void;
  onAdBlockStatusChange?: (status: unknown) => void;
  onError?: (error: unknown) => void;
  onHlsInstance?: (hls: FakeEngine) => void;
  onQualityLevels?: (levels: unknown[]) => void;
  sources?: unknown;
  channelName?: string;
}

const hlsHarness = vi.hoisted(() => ({ engines: new Map<string, FakeEngine>() }));

function createEngine(src: string): FakeEngine {
  const listeners = new Map<string, Set<(event: string, data: unknown) => void>>();
  const engine: FakeEngine = {
    config: {
      captionsTextTrack1LanguageCode: "en",
      captionsTextTrack2LanguageCode: "es",
      captionsTextTrack3LanguageCode: "",
      captionsTextTrack4LanguageCode: "",
    },
    subtitleTracks: [],
    subtitleTrack: -1,
    listeners,
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
  hlsHarness.engines.set(src, engine);
  return engine;
}

function emit(src: string, event: string, data: unknown) {
  const engine = hlsHarness.engines.get(src);
  if (!engine) throw new Error(`Missing fake HLS engine for ${src}`);
  for (const listener of engine.listeners.get(event) ?? []) listener(event, data);
}

vi.mock("@/components/player/hooks/use-resume-playback", () => ({
  useResumePlayback: vi.fn(),
}));

vi.mock("@/components/player/hooks/use-seek-preview", () => ({
  useSeekPreview: () => ({ previewImage: undefined, handleSeekHover: vi.fn() }),
}));

vi.mock("@/hooks/use-ad-element-observer", () => ({ useAdElementObserver: vi.fn() }));

vi.mock("@/components/player/hls-player", async () => {
  const React = await import("react");
  return {
    HlsPlayer: React.forwardRef<HTMLVideoElement, MockPlayerProps>(function MockHlsPlayer(
      {
        src,
        onHlsInstance,
        onQualityLevels,
        currentLevel: _currentLevel,
        hlsConfig: _hlsConfig,
        isLive: _isLive,
        onError: _onError,
        sources: _sources,
        ...videoProps
      },
      forwardedRef
    ) {
      const videoRef = React.useRef<HTMLVideoElement>(null);
      React.useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement);
      React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        Object.defineProperty(video, "duration", { configurable: true, value: 120 });
        Object.defineProperty(video, "currentTime", {
          configurable: true,
          value: 2,
          writable: true,
        });
        onHlsInstance?.(createEngine(src));
        onQualityLevels?.([
          { id: "auto", label: "Auto", width: 0, height: 0, bitrate: 0, isAuto: true },
        ]);
      }, [src]);
      return <video ref={videoRef} data-testid={`video-${src}`} {...videoProps} />;
    }),
  };
});

vi.mock("@/components/player/twitch/twitch-hls-player", async () => {
  const React = await import("react");
  return {
    TwitchHlsPlayer: React.forwardRef<HTMLVideoElement, MockPlayerProps>(
      function MockTwitchHlsPlayer(
        {
          src,
          onHlsInstance,
          onQualityLevels,
          channelName: _channelName,
          currentLevel: _currentLevel,
          enableAdBlock: _enableAdBlock,
          onAdBlockRecoveryRefresh: _onAdBlockRecoveryRefresh,
          onAdBlockStatusChange: _onAdBlockStatusChange,
          onError: _onError,
          ...videoProps
        },
        forwardedRef
      ) {
        const videoRef = React.useRef<HTMLVideoElement>(null);
        React.useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement);
        React.useEffect(() => {
          const video = videoRef.current;
          if (!video) return;
          Object.defineProperty(video, "currentTime", {
            configurable: true,
            value: 2,
            writable: true,
          });
          onHlsInstance?.(createEngine(src));
          onQualityLevels?.([
            { id: "auto", label: "Auto", width: 0, height: 0, bitrate: 0, isAuto: true },
          ]);
        }, [src]);
        return <video ref={videoRef} data-testid={`video-${src}`} {...videoProps} />;
      }
    ),
  };
});

const playerCases: Array<{
  name: string;
  src: string;
  renderPlayer: () => React.ReactNode;
}> = [
  {
    name: "Kick live",
    src: "https://kick.test/live.m3u8",
    renderPlayer: () => <KickLivePlayer streamUrl="https://kick.test/live.m3u8" />,
  },
  {
    name: "Kick VOD",
    src: "https://kick.test/vod.m3u8",
    renderPlayer: () => <KickVodPlayer streamUrl="https://kick.test/vod.m3u8" />,
  },
  {
    name: "Twitch live",
    src: "https://twitch.test/live.m3u8",
    renderPlayer: () => (
      <TwitchLivePlayer
        streamUrl="https://twitch.test/live.m3u8"
        channelName="caption-channel"
        enableAdBlock={false}
      />
    ),
  },
  {
    name: "Twitch VOD",
    src: "https://twitch.test/vod.m3u8",
    renderPlayer: () => <TwitchVodPlayer streamUrl="https://twitch.test/vod.m3u8" />,
  },
];

// Guards: every routed live and VOD player wires HLS timed text into the real settings menu and overlay.
// Guards: Twitch and Kick live players always expose Off and Local live captions without platform tracks.
// Guards: Twitch live captions use Twitch's accessible purple accent instead of the generic local-caption color.
describe("caption player wiring", () => {
  it("uses Twitch's current purple for local live caption highlights", async () => {
    const view = render(
      <TooltipProvider>
        <TwitchLivePlayer
          streamUrl="https://twitch.test/live.m3u8"
          channelName="caption-channel"
          enableAdBlock={false}
        />
      </TooltipProvider>
    );
    await waitFor(() => expect(hlsHarness.engines.has("https://twitch.test/live.m3u8")).toBe(true));

    expect(captionOverlayHarness.highlightColors).toContain(TWITCH_COLORS.accent);
    view.unmount();
  });

  it.each(
    playerCases.filter(({ name }) => name.endsWith("live"))
  )("offers local captions through the $name path before HLS exposes tracks", async ({
    src,
    renderPlayer,
  }) => {
    const view = render(<TooltipProvider>{renderPlayer()}</TooltipProvider>);
    await waitFor(() => expect(hlsHarness.engines.has(src)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const captions = screen.getByRole("button", { name: /Subtitles\/CC.*Off/ });
    expect(captions).toBeEnabled();
    fireEvent.click(captions);
    expect(screen.getByRole("radio", { name: "Off" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Local live captions (English)" })).toBeVisible();

    view.unmount();
  });

  it.each(playerCases)("renders selected cues through the $name path", async ({
    src,
    renderPlayer,
  }) => {
    const view = render(<TooltipProvider>{renderPlayer()}</TooltipProvider>);
    await waitFor(() => expect(hlsHarness.engines.has(src)).toBe(true));

    act(() => screen.getByTestId(`video-${src}`).dispatchEvent(new Event("durationchange")));

    const engine = hlsHarness.engines.get(src) as FakeEngine;
    engine.subtitleTracks = [{ name: "English", lang: "en", groupId: "subs", url: `${src}/en` }];
    act(() => emit(src, "hlsSubtitleTracksUpdated", { subtitleTracks: engine.subtitleTracks }));
    act(() => {
      emit(src, "hlsNonNativeTextTracksFound", {
        tracks: [{ _id: "textTrack1", label: "English CC", kind: "captions" }],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC/ }));
    fireEvent.click(screen.getByRole("radio", { name: "English CC" }));
    act(() => {
      emit(src, "hlsCuesParsed", {
        type: "captions",
        track: "textTrack1",
        cues: [{ text: `${src} caption`, startTime: 1, endTime: 4 }],
      });
    });

    expect(screen.getByRole("status", { name: "Captions" })).toHaveTextContent(`${src} caption`);

    view.unmount();
    expect([...engine.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });
});
