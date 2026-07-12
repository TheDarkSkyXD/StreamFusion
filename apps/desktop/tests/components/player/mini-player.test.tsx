import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerError } from "@/components/player/types";
import { fireEvent, renderWithProviders, screen, waitFor } from "../../test-utils";

const routerState = vi.hoisted(() => ({
  pathname: "/",
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const playerProps = vi.hoisted(() => ({
  kick: null as null | { onError?: (error: PlayerError) => void },
  twitch: null as null | {
    onAdBlockRecoveryRefresh?: () => void;
    onError?: (error: PlayerError) => void;
  },
}));

const streamPlaybackMock = vi.hoisted(() => ({
  useStreamPlayback: vi.fn(() => ({
    playback: null as null | { url: string; format: "hls" | "dash" | "mp4" },
    isLoading: false,
    error: null as Error | null,
    reload: vi.fn(),
    reloadAttempts: 0,
  })),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock("@/hooks/useStreamPlayback", () => streamPlaybackMock);

vi.mock("@/components/player/hls-player", async () => {
  const { forwardRef } = await import("react");
  return {
    HlsPlayer: forwardRef<
      HTMLVideoElement,
      { src: string; onError?: (error: PlayerError) => void }
    >((props, ref) => {
      playerProps.kick = props;
      return (
        <div data-testid="hls-player">
          <video ref={ref} />
          {props.src}
        </div>
      );
    }),
  };
});

vi.mock("@/components/player/twitch/twitch-hls-player", async () => {
  const { forwardRef } = await import("react");
  return {
    TwitchHlsPlayer: forwardRef<
      HTMLVideoElement,
      {
        src: string;
        onAdBlockRecoveryRefresh?: () => void;
        onError?: (error: PlayerError) => void;
      }
    >((props, ref) => {
      playerProps.twitch = props;
      return (
        <div data-testid="twitch-hls-player">
          <video ref={ref} />
          {props.src}
        </div>
      );
    }),
  };
});

vi.mock("@/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    isMuted: true,
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
    volume: 50,
    handleVolumeChange: vi.fn(),
  }),
}));

import { MiniPlayer } from "@/components/player/mini-player";
import { usePipStore } from "@/store/pip-store";

function primePipStore() {
  usePipStore.setState({
    currentStream: {
      platform: "kick",
      channelName: "xqc",
      channelDisplayName: "xQc",
      streamUrl: "https://example.test/live.m3u8",
    },
    isPipActive: true,
    isOnStreamPage: false,
  });
}

// Guards: mini-player must synchronously idle on /stream routes so the main player does not share startup with a duplicate playback subscriber.
// Guards: mini-player must not mount HLS from the persisted stream snapshot while a fresh playback URL is still resolving; stale Kick live-video tokens 403 when Following activates PiP.
// Guards: mini-player closes stale PiP state when its fresh playback lookup reports the stream unavailable, preventing an offline stream from showing as LIVE.
// Guards: mini-player playback remains exclusive to its accessible Play/Pause button; its surface and unrelated controls cannot toggle media.
describe("MiniPlayer playback routing", () => {
  beforeEach(() => {
    routerState.pathname = "/";
    playerProps.kick = null;
    playerProps.twitch = null;
    streamPlaybackMock.useStreamPlayback.mockReset();
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    mockNavigate.mockClear();
    usePipStore.setState({
      currentStream: null,
      isPipActive: false,
      isOnStreamPage: false,
    });
  });

  it("does not fetch playback or render while already on a stream route", () => {
    routerState.pathname = "/stream/kick/xqc";
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(streamPlaybackMock.useStreamPlayback).toHaveBeenCalledWith("kick", "");
    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
  });

  it("fetches playback but idles until a fresh URL resolves when the user leaves the stream route", () => {
    routerState.pathname = "/following";
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(streamPlaybackMock.useStreamPlayback).toHaveBeenCalledWith("kick", "xqc");
    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
  });

  it("renders with the fresh playback URL instead of the persisted stream snapshot", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBeInTheDocument();
    expect(screen.getByTestId("hls-player")).toHaveTextContent(
      "https://fresh.example.test/live.m3u8"
    );
    expect(screen.getByTestId("hls-player")).not.toHaveTextContent(
      "https://example.test/live.m3u8"
    );
  });

  it("labels its playback button dynamically and changes media only from that button", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();

    renderWithProviders(<MiniPlayer />);
    const mediaRoot = screen.getByTestId("hls-player");
    const video = mediaRoot.querySelector("video") as HTMLVideoElement;
    let paused = false;
    const play = vi.fn().mockImplementation(() => {
      paused = false;
      return Promise.resolve();
    });
    const pause = vi.fn().mockImplementation(() => {
      paused = true;
    });
    Object.defineProperties(video, {
      paused: { get: () => paused, configurable: true },
      play: { value: play, configurable: true },
      pause: { value: pause, configurable: true },
    });

    const controls = screen.getAllByRole("button");
    fireEvent.click(mediaRoot);
    fireEvent.click(controls[0]);
    fireEvent.click(controls[3]);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);

    fireEvent.pause(video);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    fireEvent.click(controls[1]);
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("does not reload Kick playback when mini-player HLS asks for a refresh", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    act(() => {
      playerProps.kick?.onError?.({
        code: "NO_FRAGMENTS",
        message: "No video fragments received after manifest load",
        fatal: true,
        shouldRefresh: true,
      });
    });

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload Twitch playback when mini-player HLS asks for a refresh", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    usePipStore.setState({
      currentStream: {
        platform: "twitch",
        channelName: "xqc",
        channelDisplayName: "xQc",
        streamUrl: "https://stale.example.test/live.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: false,
    });

    renderWithProviders(<MiniPlayer />);

    act(() => {
      playerProps.twitch?.onError?.({
        code: "NO_FRAGMENTS",
        message: "No video fragments received after manifest load",
        fatal: true,
      });
    });

    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads Twitch playback when mini-player HLS reports a recoverable error", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    usePipStore.setState({
      currentStream: {
        platform: "twitch",
        channelName: "xqc",
        channelDisplayName: "xQc",
        streamUrl: "https://stale.example.test/live.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: false,
    });

    renderWithProviders(<MiniPlayer />);

    act(() => {
      playerProps.twitch?.onError?.({
        code: "TOKEN_EXPIRED",
        message: "Playback token expired",
        fatal: true,
        shouldRefresh: true,
      });
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads Twitch mini-player playback when adblock recovery completes", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    usePipStore.setState({
      currentStream: {
        platform: "twitch",
        channelName: "xqc",
        channelDisplayName: "xQc",
        streamUrl: "https://stale.example.test/live.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: false,
    });

    renderWithProviders(<MiniPlayer />);

    act(() => {
      playerProps.twitch?.onAdBlockRecoveryRefresh?.();
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("closes PiP instead of showing the mini-player when fresh playback says offline", async () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: false,
      error: new Error("Channel is offline"),
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(usePipStore.getState().currentStream).toBeNull();
      expect(usePipStore.getState().isPipActive).toBe(false);
    });
  });

  it("expands back to the stream Home tab", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();

    renderWithProviders(<MiniPlayer />);
    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "xqc" },
      search: { tab: "home" },
    });
  });
});
