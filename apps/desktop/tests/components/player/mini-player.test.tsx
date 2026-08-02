import { act, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerError } from "@/components/player/types";
import { fireEvent, renderWithProviders, screen, waitFor } from "../../test-utils";

const routerState = vi.hoisted(() => ({
  pathname: "/",
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const playerProps = vi.hoisted(() => ({
  kick: null as null | { compact?: boolean; onError?: (error: PlayerError) => void },
  twitch: null as null | {
    compact?: boolean;
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
const networkStatusMock = vi.hoisted(() => ({ recoveryCount: 0 }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock("@/hooks/useStreamPlayback", () => streamPlaybackMock);
vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ recoveryCount: networkStatusMock.recoveryCount }),
}));

vi.mock("@/components/player/kick", () => ({
  KickLivePlayer: (props: {
    compact?: boolean;
    onError?: (error: PlayerError) => void;
    streamUrl?: string;
  }) => {
    playerProps.kick = props;
    return (
      <div data-testid="hls-player" data-controls={props.compact ? "compact" : "full"}>
        {props.streamUrl}
      </div>
    );
  },
}));

vi.mock("@/components/player/twitch", () => ({
  TwitchLivePlayer: (props: {
    compact?: boolean;
    onError?: (error: PlayerError) => void;
    onRefresh?: () => void;
    streamUrl?: string;
  }) => {
    playerProps.twitch = {
      ...props,
      onAdBlockRecoveryRefresh: props.onRefresh,
    };
    return (
      <div data-testid="twitch-hls-player" data-controls={props.compact ? "compact" : "full"}>
        {props.streamUrl}
      </div>
    );
  },
}));

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
import {
  PersistentPlayerShell,
  useRegisterDockedPlayerConfig,
} from "@/components/player/persistent-player-shell";
import { usePipStore } from "@/store/pip-store";

function RegisterDockedErrorHandler({ onError }: { onError: (error: PlayerError) => void }) {
  const registerDockedConfig = useRegisterDockedPlayerConfig();
  useEffect(() => {
    if (!registerDockedConfig) return;
    return registerDockedConfig({
      muted: false,
      isTheater: false,
      onError,
      onRefresh: vi.fn(),
      onToggleTheater: vi.fn(),
    });
  }, [onError, registerDockedConfig]);
  return null;
}

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

// Guards: live playback keeps the exact same player surface mounted while moving from the stream-page dock into mini-player mode.
// Guards: mini-player must not mount HLS from the persisted stream snapshot while a fresh playback URL is still resolving; stale Kick live-video tokens 403 when Following activates PiP.
// Guards: mini-player closes stale PiP state when its fresh playback lookup reports the stream unavailable, preventing an offline stream from showing as LIVE.
describe("MiniPlayer playback routing", () => {
  beforeEach(() => {
    networkStatusMock.recoveryCount = 0;
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

  it("docks on the matching stream route in the first layout pass", () => {
    routerState.pathname = "/stream/kick/xqc";
    primePipStore();
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    renderWithProviders(<MiniPlayer />);

    const player = screen.getByTestId("hls-player");
    expect(dock).toContainElement(player);
    expect(player).toHaveAttribute("data-controls", "full");
    dock.remove();
  });

  it("moves the same live player surface from the stream-page dock into mini-player mode", () => {
    routerState.pathname = "/stream/kick/xqc";
    primePipStore();
    usePipStore.setState({ isOnStreamPage: true });
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    const { rerender } = renderWithProviders(<MiniPlayer />);

    const dockedPlayer = screen.getByTestId("hls-player");
    expect(dock).toContainElement(dockedPlayer);
    expect(dockedPlayer).toHaveAttribute("data-controls", "full");

    routerState.pathname = "/following";
    act(() => usePipStore.getState().setIsOnStreamPage(false));
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBe(dockedPlayer);
    expect(dockedPlayer).toHaveAttribute("data-controls", "compact");
    expect(dock).not.toContainElement(dockedPlayer);

    dock.remove();
  });

  it("keeps the same Twitch live player surface through dock-to-mini handoff", () => {
    routerState.pathname = "/stream/twitch/xqc";
    usePipStore.setState({
      currentStream: {
        platform: "twitch",
        channelName: "xqc",
        channelDisplayName: "xQc",
        streamUrl: "https://stale.example.test/live.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: true,
    });
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const dockedPlayer = screen.getByTestId("twitch-hls-player");
    expect(dockedPlayer).toHaveAttribute("data-controls", "full");

    routerState.pathname = "/following";
    act(() => usePipStore.getState().setIsOnStreamPage(false));
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("twitch-hls-player")).toBe(dockedPlayer);
    expect(dockedPlayer).toHaveAttribute("data-controls", "compact");
    dock.remove();
  });

  it("routes docked player errors to the stream page recovery handler", () => {
    const pageErrorHandler = vi.fn();
    routerState.pathname = "/stream/kick/xqc";
    primePipStore();
    usePipStore.setState({ isOnStreamPage: true });
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    renderWithProviders(
      <PersistentPlayerShell>
        <RegisterDockedErrorHandler onError={pageErrorHandler} />
        <MiniPlayer />
      </PersistentPlayerShell>
    );

    const error: PlayerError = {
      code: "DECODER_STALL",
      message: "Decoder stopped making progress",
      fatal: true,
    };
    act(() => playerProps.kick?.onError?.(error));

    expect(pageErrorHandler).toHaveBeenCalledWith(error);
    dock.remove();
  });

  it("coalesces mini-player pointer movement into one animation-frame transform", () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 1;
      });
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
    const surface = screen.getByTestId("hls-player").parentElement as HTMLDivElement;

    fireEvent.mouseDown(surface, { clientX: 700, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 450 });
    fireEvent.mouseMove(window, { clientX: 625, clientY: 425 });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    act(() => frameCallback?.(0));
    expect(surface.style.transform).toMatch(/^translate3d\(.+px, .+px, 0\)$/);

    requestFrame.mockRestore();
  });

  it("cannot apply a pending mini drag frame after the player docks", () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 41;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const surface = screen.getByTestId("hls-player").parentElement as HTMLDivElement;
    fireEvent.mouseDown(surface, { clientX: 700, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 450 });

    routerState.pathname = "/stream/kick/xqc";
    act(() => usePipStore.getState().setIsOnStreamPage(true));
    rerender(<MiniPlayer />);
    act(() => frameCallback?.(0));

    expect(cancelFrame).toHaveBeenCalledWith(41);
    expect(surface.style.transform).toBe("");
    expect(dock).toContainElement(surface);

    requestFrame.mockRestore();
    cancelFrame.mockRestore();
    dock.remove();
  });

  it("does not dock the previous player on a different stream route", () => {
    routerState.pathname = "/stream/kick/adin";
    primePipStore();
    usePipStore.setState({ isOnStreamPage: true });
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    renderWithProviders(<MiniPlayer />);

    const previousPlayer = screen.getByTestId("hls-player");
    expect(dock).not.toContainElement(previousPlayer);
    expect(previousPlayer).toHaveAttribute("data-controls", "compact");
    dock.remove();
  });

  it("replaces the live player surface when the selected stream identity changes", () => {
    routerState.pathname = "/stream/kick/xqc";
    primePipStore();
    usePipStore.setState({ isOnStreamPage: true });
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const firstPlayer = screen.getByTestId("hls-player");

    routerState.pathname = "/stream/kick/adin";
    act(() => {
      usePipStore.getState().setCurrentStream({
        platform: "kick",
        channelName: "adin",
        channelDisplayName: "Adin",
        streamUrl: "https://example.test/adin.m3u8",
      });
    });
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).not.toBe(firstPlayer);
    dock.remove();
  });

  it("unmounts the live player surface when the mini player is closed", () => {
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

    fireEvent.click(screen.getAllByRole("button")[1]);

    expect(screen.queryByTestId("hls-player")).toBeNull();
    expect(usePipStore.getState().currentStream).toBeNull();
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

  // Guards: confirmed connectivity recovery remounts only a mini-player whose HLS engine entered an error state.
  it("remounts an errored player on confirmed recovery without touching healthy playback", () => {
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

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const healthyPlayer = screen.getByTestId("hls-player");

    networkStatusMock.recoveryCount = 1;
    rerender(<MiniPlayer />);
    expect(screen.getByTestId("hls-player")).toBe(healthyPlayer);
    expect(reload).not.toHaveBeenCalled();

    act(() => {
      playerProps.kick?.onError?.({
        code: "NO_FRAGMENTS",
        message: "Network retries were exhausted",
        fatal: true,
      });
    });
    expect(screen.queryByTestId("hls-player")).toBeNull();
    expect(screen.getByText("Stream unavailable")).toBeInTheDocument();

    networkStatusMock.recoveryCount = 2;
    rerender(<MiniPlayer />);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hls-player")).not.toBe(healthyPlayer);
    expect(screen.queryByText("Stream unavailable")).toBeNull();
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
