import { act, type Ref, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerError } from "@/features/playback/components/player/types";
import { fireEvent, renderWithProviders, screen, waitFor } from "../../test-utils";

const routerState = vi.hoisted(() => ({
  pathname: "/",
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const playerProps = vi.hoisted(() => ({
  kick: null as null | { compact?: boolean; onError?: (error: PlayerError) => void },
  twitch: null as null | {
    compact?: boolean;
    onError?: (error: PlayerError) => void;
    poster?: string;
  },
}));
const playerLifecycle = vi.hoisted(() => ({ unmounted: vi.fn() }));

const streamPlaybackMock = vi.hoisted(() => ({
  useStreamPlayback: vi.fn(
    (): {
      playback: null | { url: string; format: "hls" | "dash" | "mp4" };
      isLoading: boolean;
      error: Error | null;
      reload: ReturnType<typeof vi.fn>;
      reloadAttempts: number;
      playbackRevision?: number;
    } => ({
      playback: null,
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    })
  ),
}));
const streamStatusMock = vi.hoisted(() => ({
  useStreamByChannel: vi.fn(),
}));
const networkStatusMock = vi.hoisted(() => ({ recoveryCount: 0 }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock("@/features/playback/data/useStreamPlayback", () => streamPlaybackMock);
vi.mock("@/features/discovery/data/queries/useStreams", () => streamStatusMock);
vi.mock("@/features/settings/data/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ recoveryCount: networkStatusMock.recoveryCount }),
}));

vi.mock("@/features/playback/components/player/kick/kick-live-player", () => ({
  KickLivePlayer: (props: {
    compact?: boolean;
    onError?: (error: PlayerError) => void;
    ref?: Ref<HTMLVideoElement>;
    streamUrl?: string;
  }) => {
    playerProps.kick = props;
    useEffect(() => () => playerLifecycle.unmounted("kick"), []);
    return (
      <div data-testid="hls-player" data-controls={props.compact ? "compact" : "full"}>
        {props.streamUrl}
        <video ref={props.ref} data-testid="kick-video-element" />
      </div>
    );
  },
}));

vi.mock("@/features/playback/components/player/twitch/twitch-live-player", () => ({
  TwitchLivePlayer: (props: {
    compact?: boolean;
    onError?: (error: PlayerError) => void;
    onRefresh?: () => void;
    ref?: Ref<HTMLVideoElement>;
    streamUrl?: string;
  }) => {
    playerProps.twitch = props;
    useEffect(() => () => playerLifecycle.unmounted("twitch"), []);
    return (
      <div data-testid="twitch-hls-player" data-controls={props.compact ? "compact" : "full"}>
        {props.streamUrl}
        <video ref={props.ref} data-testid="twitch-video-element" />
      </div>
    );
  },
}));

vi.mock("@/features/playback/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    isMuted: true,
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
    volume: 50,
    handleVolumeChange: vi.fn(),
  }),
}));

import { MiniPlayer } from "@/features/playback/components/player/mini-player";
import {
  PersistentPlayerShell,
  useRegisterDockedPlayerConfig,
} from "@/features/playback/components/player/persistent-player-shell";
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
// Guards: returning to the same Kick or Twitch stream docks the existing player even when the route dock mounts after navigation.
// Guards: switching directly between stream routes never flashes the previous stream as a corner mini-player while the next stream activates.
// Guards: mini-player must not mount HLS from the persisted stream snapshot while a fresh playback URL is still resolving; stale Kick live-video tokens 403 when Following activates PiP.
// Guards: confirmed offline playback keeps the mini-player frame open while replacing obsolete playback with the shared offline state.
// Guards: Twitch poster continuity follows the persistent player from its stream-page dock into mini-player mode.
// Guards: VOD and MultiView routes own media playback exclusively and cannot leave the persistent live decoder running behind them.
describe("MiniPlayer playback routing", () => {
  beforeEach(() => {
    networkStatusMock.recoveryCount = 0;
    routerState.pathname = "/";
    playerProps.kick = null;
    playerProps.twitch = null;
    playerLifecycle.unmounted.mockClear();
    streamPlaybackMock.useStreamPlayback.mockReset();
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReset();
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: undefined,
      dataUpdatedAt: 0,
      isError: false,
      isLoading: true,
      isPlaceholderData: false,
      isSuccess: false,
      refetch: vi.fn(),
    });
    mockNavigate.mockClear();
    usePipStore.setState({
      currentStream: null,
      isPipActive: false,
      isOnStreamPage: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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
    const playerHost = player.closest("[data-player-mode='docked']");
    expect(dock).toContainElement(player);
    expect(playerHost).toHaveStyle({ width: "100%", height: "100%" });
    expect(player).toHaveAttribute("data-controls", "full");
    dock.remove();
  });

  it.each(["/video/twitch/vod-1", "/multistream"])(
    "unmounts persistent live playback on exclusive route %s and restores it after leaving",
    (exclusiveRoute) => {
      routerState.pathname = exclusiveRoute;
      primePipStore();
      streamPlaybackMock.useStreamPlayback.mockReturnValue({
        playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
        isLoading: false,
        error: null,
        reload: vi.fn(),
        reloadAttempts: 0,
      });

      const { rerender } = renderWithProviders(<MiniPlayer />);
      expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();

      routerState.pathname = "/history";
      rerender(<MiniPlayer />);
      expect(screen.getByTestId("hls-player")).toBeInTheDocument();
    }
  );

  it("keeps the player docked while switching directly to a different stream route", () => {
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

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const player = screen.getByTestId("hls-player");
    const playerHost = player.closest("[data-player-mode='docked']");

    routerState.pathname = "/stream/twitch/agent00";
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBe(player);
    expect(dock).toContainElement(player);
    expect(player.closest("[data-player-mode='docked']")).toBe(playerHost);
    expect(player).toHaveAttribute("data-controls", "full");
    expect(document.querySelector("[data-player-mode='mini']")).toBeNull();
    dock.remove();
  });

  it.each([
    ["kick", "hls-player", "https://fresh.example.test/kick-live.m3u8"],
    ["twitch", "twitch-hls-player", "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"],
  ] as const)(
    "docks the existing %s player when the matching route dock mounts late",
    async (platform, playerTestId, playbackUrl) => {
      routerState.pathname = "/settings";
      usePipStore.setState({
        currentStream: {
          platform,
          channelName: "xqc",
          channelDisplayName: "xQc",
          streamUrl: "https://stale.example.test/live.m3u8",
        },
        isPipActive: true,
        isOnStreamPage: false,
      });
      streamPlaybackMock.useStreamPlayback.mockReturnValue({
        playback: { url: playbackUrl, format: "hls" },
        isLoading: false,
        error: null,
        reload: vi.fn(),
        reloadAttempts: 0,
      });

      const { rerender } = renderWithProviders(<MiniPlayer />);
      const player = screen.getByTestId(playerTestId);
      const playerHost = player.closest("[data-player-mode='mini']") as HTMLElement;

      routerState.pathname = `/stream/${platform}/xqc`;
      rerender(<MiniPlayer />);
      expect(screen.getByTestId(playerTestId)).toBe(player);

      const dock = document.createElement("div");
      dock.id = "persistent-live-player-dock";
      document.body.append(dock);

      try {
        await waitFor(() => expect(dock).toContainElement(player));
        expect(screen.getByTestId(playerTestId)).toBe(player);
        expect(player.closest("[data-player-mode='docked']")).toBe(playerHost);
        expect(playerHost).toHaveStyle({ width: "100%", height: "100%" });
        expect(player).toHaveAttribute("data-controls", "full");
      } finally {
        dock.remove();
      }
    }
  );

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
    const playerHost = dockedPlayer.closest("[data-player-mode='docked']") as HTMLElement;
    expect(dock).toContainElement(dockedPlayer);
    expect(playerHost).toHaveStyle({ width: "100%", height: "100%" });
    expect(dockedPlayer).toHaveAttribute("data-controls", "full");

    routerState.pathname = "/following";
    act(() => usePipStore.getState().setIsOnStreamPage(false));
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBe(dockedPlayer);
    expect(dockedPlayer).toHaveAttribute("data-controls", "compact");
    expect(dock).not.toContainElement(dockedPlayer);
    expect(playerHost.style.width).toBe("");
    expect(playerHost.style.height).toBe("");

    dock.remove();
  });

  it("keeps the same Twitch live player surface through dock-to-mini handoff", () => {
    routerState.pathname = "/stream/twitch/xqc";
    usePipStore.setState({
      currentStream: {
        platform: "twitch",
        channelName: "xqc",
        channelDisplayName: "xQc",
        poster: "https://static-cdn.jtvnw.net/previews-ttv/live_user_xqc-440x248.jpg",
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
    const playerHost = dockedPlayer.closest("[data-player-mode='docked']");
    expect(playerHost).toHaveStyle({ width: "100%", height: "100%" });
    expect(dockedPlayer).toHaveAttribute("data-controls", "full");
    expect(playerProps.twitch?.poster).toBe(
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_xqc-440x248.jpg"
    );

    routerState.pathname = "/following";
    act(() => usePipStore.getState().setIsOnStreamPage(false));
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("twitch-hls-player")).toBe(dockedPlayer);
    expect(dockedPlayer).toHaveAttribute("data-controls", "compact");
    expect(playerProps.twitch?.poster).toBe(
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_xqc-440x248.jpg"
    );
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

  it("does not show mini mode when a stream route opens with a previous player snapshot", () => {
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
    expect(dock).toContainElement(previousPlayer);
    expect(previousPlayer).toHaveAttribute("data-controls", "full");
    expect(document.querySelector("[data-player-mode='mini']")).toBeNull();
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

  it("updates an ordinary playback refresh without replacing the live player", () => {
    routerState.pathname = "/following";
    primePipStore();
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/first.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
      playbackRevision: 1,
    });

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const persistentPlayer = screen.getByTestId("hls-player");

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/refreshed.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
      playbackRevision: 2,
    });
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBe(persistentPlayer);
    expect(persistentPlayer).toHaveTextContent("https://fresh.example.test/refreshed.m3u8");
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

  it("reloads Kick playback when mini-player HLS asks for a refresh", () => {
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
    const failedPlayer = screen.getByTestId("hls-player");

    act(() => {
      playerProps.kick?.onError?.({
        code: "NO_FRAGMENTS",
        message: "No video fragments received after manifest load",
        fatal: true,
        shouldRefresh: true,
      });
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hls-player")).not.toBe(failedPlayer);
    expect(screen.queryByText("Stream unavailable")).not.toBeInTheDocument();
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

  it("shows a manual retry when Twitch recovery exhausts without a new source", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
      playbackRevision: 1,
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
        code: "PLAYBACK_STALL",
        message: "Playback stopped advancing",
        fatal: true,
      });
    });
    await act(async () => vi.advanceTimersByTimeAsync(9_500));

    expect(reload).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("twitch-hls-player")).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry playback" });

    fireEvent.click(retry);

    expect(reload).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("twitch-hls-player")).toBeInTheDocument();
  });

  it.each([
    ["kick", "hls-player", "https://fresh.example.test/live.m3u8"],
    ["twitch", "twitch-hls-player", "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"],
  ] as const)(
    "rechecks %s playback instead of showing unavailable after a transient network failure",
    async (platform, playerTestId, playbackUrl) => {
      if (platform === "twitch") vi.useFakeTimers();
      const reload = vi.fn();
      routerState.pathname = "/following";
      streamPlaybackMock.useStreamPlayback.mockReturnValue({
        playback: { url: playbackUrl, format: "hls" },
        isLoading: false,
        error: null,
        reload,
        reloadAttempts: 0,
      });
      usePipStore.setState({
        currentStream: {
          platform,
          channelName: "xqc",
          channelDisplayName: "xQc",
          streamUrl: "https://stale.example.test/live.m3u8",
        },
        isPipActive: true,
        isOnStreamPage: false,
      });

      renderWithProviders(<MiniPlayer />);

      act(() => {
        const props = platform === "kick" ? playerProps.kick : playerProps.twitch;
        props?.onError?.({
          code: "STREAM_OFFLINE",
          message: "Stream offline or unavailable",
          fatal: true,
          originalError: { type: "networkError", details: "fragLoadError" },
        });
      });

      if (platform === "twitch") {
        await act(async () => vi.advanceTimersByTimeAsync(1_500));
      }

      expect(reload).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId(playerTestId)).toBeInTheDocument();
      expect(screen.queryByText("Stream unavailable")).not.toBeInTheDocument();
    }
  );

  it("shows the offline state for an explicit offline manifest response", () => {
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
        code: "STREAM_OFFLINE",
        message: "Stream offline or unavailable",
        fatal: true,
        originalError: { response: { code: 404 } },
      });
    });

    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
    expect(screen.getByText("is currently offline")).toBeInTheDocument();
    expect(usePipStore.getState().currentStream?.channelName).toBe("xqc");
    expect(playerLifecycle.unmounted).toHaveBeenCalledWith("kick");
  });

  it("refreshes a signed-media 403 instead of declaring the mini stream offline", () => {
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
        code: "STREAM_OFFLINE",
        message: "Signed media URL expired",
        fatal: true,
        shouldRefresh: true,
        originalError: { response: { code: 403 } },
      });
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hls-player")).toBeInTheDocument();
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
  });

  it("shows offline after fatal live-playback recovery is exhausted", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 2,
    });
    primePipStore();
    renderWithProviders(<MiniPlayer />);

    act(() => {
      playerProps.kick?.onError?.({
        code: "NO_FRAGMENTS",
        message: "No video fragments received after recovery",
        fatal: true,
        shouldRefresh: true,
      });
    });

    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
    expect(screen.getByText("is currently offline")).toBeInTheDocument();
    expect(playerLifecycle.unmounted).toHaveBeenCalledWith("kick");
  });

  it("shows offline when the current live media element ends", () => {
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

    fireEvent.ended(screen.getByTestId("kick-video-element"));

    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
    expect(screen.getByText("is currently offline")).toBeInTheDocument();
    expect(usePipStore.getState().currentStream?.channelName).toBe("xqc");
  });

  it("keeps verified playback visible during transient waiting and stalled events", () => {
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
    const player = screen.getByTestId("hls-player");
    const video = screen.getByTestId("kick-video-element");

    fireEvent.waiting(video);
    fireEvent.stalled(video);

    expect(screen.getByTestId("hls-player")).toBe(player);
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads after media ended only when a newer canonical status confirms live", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "kick", channelName: "xqc", isLive: true },
      dataUpdatedAt: 1,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    primePipStore();
    const { rerender } = renderWithProviders(<MiniPlayer />);

    fireEvent.ended(screen.getByTestId("kick-video-element"));

    expect(screen.getByText("is currently offline")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();

    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "kick", channelName: "xqc", isLive: true },
      dataUpdatedAt: 2,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    rerender(<MiniPlayer />);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hls-player")).toBeInTheDocument();
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
  });

  it("reloads once when newer canonical status supersedes resolver-confirmed offline", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "kick", channelName: "xqc", isLive: true },
      dataUpdatedAt: 1,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    primePipStore();
    const { rerender } = renderWithProviders(<MiniPlayer />);
    expect(screen.getByTestId("hls-player")).toBeInTheDocument();

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: false,
      error: new Error("Channel is offline"),
      reload,
      reloadAttempts: 0,
    });
    rerender(<MiniPlayer />);
    expect(screen.getByText("is currently offline")).toBeInTheDocument();

    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "kick", channelName: "xqc", isLive: true },
      dataUpdatedAt: 2,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    rerender(<MiniPlayer />);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("is currently offline")).toBeInTheDocument();

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: true,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    rerender(<MiniPlayer />);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hls-player")).toBeInTheDocument();
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
  });

  it("reloads playback once when canonical status confirms the same mini stream is live again", () => {
    const reload = vi.fn();
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload,
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: null,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
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
    const { rerender } = renderWithProviders(<MiniPlayer />);
    expect(screen.getByText("is currently offline")).toBeInTheDocument();

    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "twitch", channelName: "xqc", isLive: true },
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    rerender(<MiniPlayer />);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("twitch-hls-player")).toBeInTheDocument();
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
  });

  it("remounts the mini player when refreshed playback keeps the same manifest URL", () => {
    routerState.pathname = "/following";
    const playbackUrl = "https://fresh.example.test/live.m3u8";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: playbackUrl, format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
      playbackRevision: 1,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "kick", channelName: "xqc", isLive: true },
      dataUpdatedAt: 1,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    primePipStore();
    const { rerender } = renderWithProviders(<MiniPlayer />);
    const stalePlayer = screen.getByTestId("hls-player");

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: true,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 1,
      playbackRevision: 1,
    });
    rerender(<MiniPlayer />);
    expect(screen.getByTestId("hls-player")).toBe(stalePlayer);

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: playbackUrl, format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
      playbackRevision: 2,
    });
    rerender(<MiniPlayer />);

    const recoveredPlayer = screen.getByTestId("hls-player");
    expect(recoveredPlayer).not.toBe(stalePlayer);
    expect(playerLifecycle.unmounted).toHaveBeenCalledWith("kick");

    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBe(recoveredPlayer);
    expect(playerLifecycle.unmounted).toHaveBeenCalledTimes(1);
  });

  it("reloads Twitch playback when mini-player HLS reports a recoverable error", async () => {
    vi.useFakeTimers();
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

    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the mini-player frame open and shows offline when fresh playback says offline", async () => {
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
    expect((await screen.findAllByText("xQc")).length).toBeGreaterThan(0);
    expect(screen.getByText("is currently offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore stream" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close mini player" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(usePipStore.getState().currentStream?.channelName).toBe("xqc");
    expect(usePipStore.getState().isPipActive).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Restore stream" }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "xqc" },
      search: { tab: "home" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close mini player" }));
    expect(usePipStore.getState().currentStream).toBeNull();
  });

  it("shows offline when the current Twitch status becomes authoritatively offline", () => {
    routerState.pathname = "/following";
    const refetch = vi.fn();
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "twitch", channelName: "xqc", isLive: true },
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch,
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

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const frame = screen.getByTestId("twitch-hls-player").closest("[data-player-mode='mini']");

    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: null,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch,
    });
    rerender(<MiniPlayer />);

    expect(screen.queryByTestId("twitch-hls-player")).not.toBeInTheDocument();
    expect(screen.getByText("is currently offline")).toBeInTheDocument();
    expect(document.querySelector("[data-player-mode='mini']")).toBe(frame);
    expect(usePipStore.getState().currentStream?.channelName).toBe("xqc");
    expect(playerLifecycle.unmounted).toHaveBeenCalledWith("twitch");
  });

  it("shows offline for route-matched confirmed Kick status", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "kick", channelName: "xqc", isLive: false },
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(screen.queryByTestId("hls-player")).not.toBeInTheDocument();
    expect(screen.getByText("is currently offline")).toBeInTheDocument();
    expect(usePipStore.getState().currentStream?.platform).toBe("kick");
  });

  it("keeps verified playback visible while current stream status is still loading", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
      isPlaceholderData: false,
      isSuccess: false,
      refetch: vi.fn(),
    });
    primePipStore();

    renderWithProviders(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBeInTheDocument();
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
  });

  it("ignores a superseded offline result after the mini-player switches channels", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: null,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    usePipStore.setState({
      currentStream: {
        platform: "twitch",
        channelName: "xqc",
        channelDisplayName: "xQc",
        streamUrl: "https://stale.example.test/xqc.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: false,
    });
    const { rerender } = renderWithProviders(<MiniPlayer />);
    expect(screen.getByText("is currently offline")).toBeInTheDocument();

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/adin.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "twitch", channelName: "xqc", isLive: false },
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    act(() => {
      usePipStore.setState({
        currentStream: {
          platform: "twitch",
          channelName: "adin",
          channelDisplayName: "Adin",
          streamUrl: "https://stale.example.test/adin.m3u8",
        },
        isPipActive: true,
        isOnStreamPage: false,
      });
    });
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("twitch-hls-player")).toHaveTextContent(
      "https://fresh.example.test/adin.m3u8"
    );
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
  });

  it("ignores a stale player callback after the mini-player switches channels", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/xqc.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();
    const { rerender } = renderWithProviders(<MiniPlayer />);
    const staleKickError = playerProps.kick?.onError;
    expect(staleKickError).toBeTypeOf("function");

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/adin.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    streamStatusMock.useStreamByChannel.mockReturnValue({
      data: { platform: "twitch", channelName: "adin", isLive: true },
      dataUpdatedAt: 2,
      isError: false,
      isLoading: false,
      isPlaceholderData: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    act(() => {
      usePipStore.setState({
        currentStream: {
          platform: "twitch",
          channelName: "adin",
          channelDisplayName: "Adin",
          streamUrl: "https://stale.example.test/adin.m3u8",
        },
        isPipActive: true,
        isOnStreamPage: false,
      });
    });
    rerender(<MiniPlayer />);

    act(() => {
      staleKickError?.({
        code: "STREAM_OFFLINE",
        message: "Old Kick manifest is gone",
        fatal: true,
        originalError: { response: { code: 404 } },
      });
    });

    expect(screen.getByTestId("twitch-hls-player")).toHaveTextContent(
      "https://fresh.example.test/adin.m3u8"
    );
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
  });

  it("keeps the verified mini-player alive when a playback refresh fails transiently", async () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const verifiedPlayer = screen.getByTestId("hls-player");

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: false,
      error: new Error("Playback service temporarily unavailable"),
      reload: vi.fn(),
      reloadAttempts: 1,
    });
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBe(verifiedPlayer);
    await waitFor(() => {
      expect(usePipStore.getState().currentStream?.channelName).toBe("xqc");
      expect(usePipStore.getState().isPipActive).toBe(true);
    });
  });

  it("does not treat speculative resolver exhaustion as confirmed offline", () => {
    routerState.pathname = "/following";
    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: { url: "https://fresh.example.test/live.m3u8", format: "hls" },
      isLoading: false,
      error: null,
      reload: vi.fn(),
      reloadAttempts: 0,
    });
    primePipStore();

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const verifiedPlayer = screen.getByTestId("hls-player");

    streamPlaybackMock.useStreamPlayback.mockReturnValue({
      playback: null,
      isLoading: false,
      error: new Error("Max reload attempts reached - stream may be offline"),
      reload: vi.fn(),
      reloadAttempts: 3,
    });
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("hls-player")).toBe(verifiedPlayer);
    expect(screen.queryByText("is currently offline")).not.toBeInTheDocument();
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
