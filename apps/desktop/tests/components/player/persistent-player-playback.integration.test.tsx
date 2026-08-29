import { act, forwardRef, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MiniPlayer } from "@/features/playback/components/player/mini-player";
import {
  PersistentPlayerShell,
  useRegisterDockedPlayerConfig,
} from "@/features/playback/components/player/persistent-player-shell";
import { useStreamPlayback } from "@/features/playback/data/useStreamPlayback";
import { usePipStore } from "@/store/pip-store";
import { useVolumeStore } from "@/store/volume-store";
import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../test-utils";

const routerState = vi.hoisted(() => ({ pathname: "/following" }));
const getPlaybackUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: routerState.pathname }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/features/playback/components/player/kick/kick-hls-player", () => ({
  KickHlsPlayer: forwardRef<HTMLVideoElement, { src: string; muted?: boolean }>(
    ({ src, muted }, ref) => (
      <video ref={ref} data-testid="real-kick-wrapper-source" data-source={src} muted={muted} />
    )
  ),
}));

function PagePlaybackOwner() {
  const playback = useStreamPlayback("kick", "shared-wrapper");
  return (
    <button type="button" onClick={playback.reload}>
      Refresh page playback
    </button>
  );
}

function DockedConfig({ muted }: { muted: boolean }) {
  const registerDockedConfig = useRegisterDockedPlayerConfig();
  useEffect(() => {
    if (!registerDockedConfig) return;
    return registerDockedConfig({
      muted,
      isTheater: false,
      onError: vi.fn(),
      onRefresh: vi.fn(),
      onToggleTheater: vi.fn(),
    });
  }, [muted, registerDockedConfig]);
  return null;
}

// Guards: a StreamPage-owned refresh must update the source inside the already-mounted real KickLivePlayer wrapper used by the persistent player.
describe("persistent player playback ownership", () => {
  beforeEach(() => {
    routerState.pathname = "/following";
    const electronAPI = installElectronAPIMock();
    electronAPI.localCaptions.onModelState = vi.fn(() => vi.fn());
    electronAPI.localCaptions.onRecognizerState = vi.fn(() => vi.fn());
    electronAPI.localCaptions.onResult = vi.fn(() => vi.fn());
    getPlaybackUrlMock
      .mockReset()
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.test/first.m3u8", format: "hls" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { url: "https://example.test/refreshed.m3u8", format: "hls" },
      });
    electronAPI.streams.getPlaybackUrl = getPlaybackUrlMock;
    usePipStore.setState({
      currentStream: {
        platform: "kick",
        channelName: "shared-wrapper",
        channelDisplayName: "Shared Wrapper",
        streamUrl: "https://example.test/stale.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: false,
    });
    useVolumeStore.setState({ volume: 100, isMuted: false });
  });

  it("refreshes the visible wrapper source without replacing its video element", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <PagePlaybackOwner />
        <MiniPlayer />
      </>
    );

    const video = (await screen.findByTestId("real-kick-wrapper-source")) as HTMLVideoElement;
    await waitFor(() =>
      expect(video).toHaveAttribute("data-source", expect.stringContaining("first.m3u8"))
    );

    await user.click(screen.getByRole("button", { name: "Refresh page playback" }));

    await waitFor(() =>
      expect(video).toHaveAttribute("data-source", expect.stringContaining("refreshed.m3u8"))
    );
    expect(screen.getByTestId("real-kick-wrapper-source")).toBe(video);
  });

  it("keeps the exact video mounted when the route leaves before PiP activation catches up", async () => {
    routerState.pathname = "/stream/kick/shared-wrapper";
    usePipStore.setState({ isPipActive: false, isOnStreamPage: true });
    const dock = document.createElement("div");
    dock.id = "persistent-live-player-dock";
    document.body.append(dock);

    const { rerender } = renderWithProviders(<MiniPlayer />);
    const video = (await screen.findByTestId(
      "real-kick-wrapper-source"
    )) as HTMLVideoElement;
    expect(dock).toContainElement(video);

    routerState.pathname = "/following";
    rerender(<MiniPlayer />);

    expect(screen.getByTestId("real-kick-wrapper-source")).toBe(video);
    expect(dock).not.toContainElement(video);
    expect(video.closest("[data-player-mode='mini']")).not.toBeNull();
    dock.remove();
  });

  it("preserves the user's volume preference while docked clip mute opens and closes", async () => {
    vi.useFakeTimers();
    try {
      routerState.pathname = "/stream/kick/shared-wrapper";
      usePipStore.setState({ isOnStreamPage: true });
      useVolumeStore.setState({ volume: 37, isMuted: false });
      const dock = document.createElement("div");
      dock.id = "persistent-live-player-dock";
      document.body.append(dock);

      const { rerender } = renderWithProviders(
        <PersistentPlayerShell>
          <DockedConfig muted={true} />
          <MiniPlayer />
        </PersistentPlayerShell>
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      const video = screen.getByTestId<HTMLVideoElement>("real-kick-wrapper-source");
      expect(video.muted).toBe(true);
      act(() => video.dispatchEvent(new Event("volumechange")));

      expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: false });

      rerender(
        <PersistentPlayerShell>
          <DockedConfig muted={false} />
          <MiniPlayer />
        </PersistentPlayerShell>
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(video.muted).toBe(false);
      expect(video.volume).toBeCloseTo(0.37);
      expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: false });
      dock.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves mini playback listeners from stream A to the replacement stream B video", async () => {
    routerState.pathname = "/following";
    getPlaybackUrlMock.mockImplementation(async ({ channelSlug }: { channelSlug: string }) => ({
      success: true,
      data: { url: `https://example.test/${channelSlug}.m3u8`, format: "hls" },
    }));
    usePipStore.setState({
      currentStream: {
        platform: "kick",
        channelName: "listener-a",
        channelDisplayName: "Listener A",
        streamUrl: "https://example.test/stale-a.m3u8",
      },
      isPipActive: true,
      isOnStreamPage: false,
    });

    renderWithProviders(<MiniPlayer />);
    const videoA = (await screen.findByTestId("real-kick-wrapper-source")) as HTMLVideoElement;
    act(() => videoA.dispatchEvent(new Event("pause")));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    act(() => {
      usePipStore.setState({
        currentStream: {
          platform: "kick",
          channelName: "listener-b",
          channelDisplayName: "Listener B",
          streamUrl: "https://example.test/stale-b.m3u8",
        },
        isPipActive: true,
        isOnStreamPage: false,
      });
    });

    const videoB = await waitFor(() => {
      const current = screen.getByTestId("real-kick-wrapper-source") as HTMLVideoElement;
      expect(current).not.toBe(videoA);
      return current;
    });
    act(() => videoB.dispatchEvent(new Event("play")));

    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });
});
