import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../test-utils";
import { usePlaybackPositionStore } from "@/store/playback-position-store";

const removeFromHistory = vi.fn();
const clearHistory = vi.fn();
const navigate = vi.fn();
let mockHistory: Array<{
  id: string;
  originalId: string;
  title: string;
  thumbnail?: string;
  playbackUrl?: string;
  platform: "twitch" | "kick";
  type: "video" | "clip" | "stream";
  channelName: string;
  channelDisplayName?: string;
  channelAvatar?: string | null;
  channelFollowerCount?: number;
  clipDuration?: string;
  clipViews?: string;
  clipDate?: string;
  clipCreatedAt?: string;
  clipCreatorName?: string;
  clipGameName?: string;
  clipCategory?: string;
  clipVodId?: string;
  clipLanguage?: string;
  timestamp: number;
}> = [];

vi.mock("@tanstack/react-router", () => ({
  ...routerMock(),
  useNavigate: () => navigate,
}));

vi.mock("@/hooks/queries/useHistoryQuery", () => ({
  useHistoryActions: () => ({ clearHistory, removeFromHistory }),
  useHistoryQuery: () => ({ data: mockHistory }),
}));

interface DialogClip {
  title: string;
  views?: string;
  viewCount?: string;
  view_count?: string;
  category?: string;
  gameName?: string;
  creatorName?: string;
  channelAvatar?: string;
}

interface DialogChannel {
  avatarUrl?: string;
  followerCount?: number;
}

vi.mock("@/components/stream/related-content/ClipDialog", () => ({
  ClipDialog: ({
    selectedClip,
    channelData,
  }: {
    selectedClip: DialogClip | null;
    channelData?: DialogChannel;
  }) =>
    selectedClip ? (
      <div data-testid="history-clip-dialog">
        <span>{selectedClip.title}</span>
        <span>
          {selectedClip.views || selectedClip.viewCount || selectedClip.view_count
            ? `${selectedClip.views || selectedClip.viewCount || selectedClip.view_count} views`
            : "no views"}
        </span>
        <span>{selectedClip.category || selectedClip.gameName || "no category"}</span>
        <span>
          {selectedClip.creatorName ? `Clipped by @${selectedClip.creatorName}` : "no creator"}
        </span>
        <span>{selectedClip.channelAvatar || channelData?.avatarUrl || "no avatar"}</span>
        <span>
          {typeof channelData?.followerCount === "number"
            ? `${channelData.followerCount} followers`
            : "no followers"}
        </span>
      </div>
    ) : null,
}));

import { HistoryPage } from "@/pages/History";

// Guards: history verifies stale videos/clips before opening, plays clips inline, and opens stream entries on Home by default.
// Guards: empty history stays distinct from populated history and clear-all remains confirm-gated.
describe("HistoryPage", () => {
  beforeEach(() => {
    removeFromHistory.mockReset();
    clearHistory.mockReset();
    navigate.mockReset();
    mockHistory = [];
    usePlaybackPositionStore.setState({ positions: {} });
    const api = installElectronAPIMock();
    api.videos.getPlaybackUrl = vi
      .fn()
      .mockResolvedValue({ success: true, data: { url: "vod.m3u8" } });
    api.clips.getByChannel = vi.fn().mockResolvedValue({ success: true, data: [] });
    api.clips.getPlaybackUrl = vi
      .fn()
      .mockResolvedValue({ success: true, data: { url: "clip.m3u8" } });
    api.channels.getByUsername = vi.fn().mockResolvedValue({
      data: {
        id: "channel-1",
        platform: "kick",
        username: "xqc",
        displayName: "xQc",
        avatarUrl: "real-channel-avatar.jpg",
        followerCount: 1000,
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    });
  });

  it("shows saved progress on VOD history entries using the saved duration", () => {
    usePlaybackPositionStore.getState().savePosition("twitch", "v1", 120, 480);
    mockHistory = [
      {
        id: "twitch-video-v1",
        originalId: "v1",
        title: "Partly watched VOD",
        platform: "twitch",
        type: "video",
        channelName: "ninja",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);

    expect(screen.getByRole("progressbar", { name: "Watch progress" })).toHaveAttribute(
      "aria-valuenow",
      "25"
    );
  });

  it("does not show VOD progress on clip history entries", () => {
    usePlaybackPositionStore.getState().savePosition("kick", "c1", 120, 480);
    mockHistory = [
      {
        id: "kick-clip-c1",
        originalId: "c1",
        title: "A clip",
        platform: "kick",
        type: "clip",
        channelName: "xqc",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);

    expect(screen.queryByRole("progressbar", { name: "Watch progress" })).not.toBeInTheDocument();
  });

  it("shows empty-state when no history exists", () => {
    renderWithProviders(<HistoryPage />);
    expect(screen.getByText(/no watch history yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/clear history/i)).not.toBeInTheDocument();
  });

  it("renders history items grouped with platform/type badges", () => {
    mockHistory = [
      {
        id: "1",
        originalId: "v1",
        title: "Cool VOD",
        platform: "twitch",
        type: "video",
        channelName: "ninja",
        channelDisplayName: "Ninja",
        timestamp: Date.now(),
      },
      {
        id: "2",
        originalId: "c1",
        title: "Insane clip",
        platform: "kick",
        type: "clip",
        channelName: "xqc",
        timestamp: Date.now(),
      },
    ];
    renderWithProviders(<HistoryPage />);
    expect(screen.getByText("Cool VOD")).toBeInTheDocument();
    expect(screen.getByText("Insane clip")).toBeInTheDocument();
    expect(screen.getByText("twitch")).toBeInTheDocument();
    expect(screen.getByText("kick")).toBeInTheDocument();
  });

  it("never requests persisted provider thumbnails from their raw CDN URLs", () => {
    const twitchProcessingThumbnail =
      "https://vod-secure.twitch.tv/_404/404_processing_90x60.png";
    const kickThumbnail =
      "https://images.kick.com/video_thumbnails/DsuAwCgUc9Bh/lB7LKqQzyR6s/720.webp";
    mockHistory = [
      {
        id: "twitch-video-processing",
        originalId: "v-processing",
        title: "Processing Twitch VOD",
        platform: "twitch",
        type: "video",
        channelName: "twitch-channel",
        thumbnail: twitchProcessingThumbnail,
        timestamp: Date.now(),
      },
      {
        id: "kick-video-thumbnail",
        originalId: "v-kick",
        title: "Kick VOD",
        platform: "kick",
        type: "video",
        channelName: "kick-channel",
        thumbnail: kickThumbnail,
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);

    expect(screen.queryByRole("img", { name: "Processing Twitch VOD" })).toBeNull();
    expect(screen.getByRole("img", { name: "Kick VOD" })).toHaveAttribute(
      "src",
      expect.stringMatching(/^kick-image:\/\/image\?u=/)
    );
    expect(document.querySelector(`img[src="${twitchProcessingThumbnail}"]`)).toBeNull();
    expect(document.querySelector(`img[src="${kickThumbnail}"]`)).toBeNull();
  });

  it("opens playable clip history items in the clip dialog", async () => {
    vi.mocked(window.electronAPI.clips.getByChannel).mockResolvedValue({
      success: true,
      data: [
        {
          id: "c1",
          title: "Insane clip",
          duration: "0:30",
          views: "12345",
          viewCount: 12345,
          category: "Fortnite",
          creatorName: "clipmaster",
          date: "2026-06-01T00:00:00.000Z",
          created_at: "2026-06-01T00:00:00.000Z",
          thumbnailUrl: "real-thumb.jpg",
          embedUrl: "https://clips.example/real.m3u8",
          url: "https://kick.com/xqc/clips/c1",
          channelSlug: "xqc",
          channelName: "xQc",
          channelAvatar: "real-clip-avatar.jpg",
          platform: "kick",
        },
      ],
    });
    mockHistory = [
      {
        id: "2",
        originalId: "c1",
        title: "Insane clip",
        platform: "kick",
        type: "clip",
        channelName: "xqc",
        playbackUrl: "https://clips.example/clip.m3u8",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);

    fireEvent.click(screen.getByRole("button", { name: "Insane clip" }));

    expect(window.electronAPI.clips.getByChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        channelName: "xqc",
        sort: "date",
        timeRange: "all",
      })
    );
    await waitFor(() => {
      expect(window.electronAPI.clips.getPlaybackUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "kick",
          clipId: "c1",
          clipUrl: "https://clips.example/real.m3u8",
        })
      );
    });
    expect(await screen.findByTestId("history-clip-dialog")).toHaveTextContent("Insane clip");
    expect(await screen.findByText("12345 views")).toBeInTheDocument();
    expect(await screen.findByText("Fortnite")).toBeInTheDocument();
    expect(await screen.findByText("Clipped by @clipmaster")).toBeInTheDocument();
    expect(await screen.findByText("real-clip-avatar.jpg")).toBeInTheDocument();
    expect(await screen.findByText("1000 followers")).toBeInTheDocument();
  });

  it("removes a clip history item when playback verification fails", async () => {
    vi.mocked(window.electronAPI.clips.getPlaybackUrl).mockResolvedValue({
      success: false,
      error: "Clip not found",
    });
    mockHistory = [
      {
        id: "kick-clip-c1",
        originalId: "c1",
        title: "Removed clip",
        platform: "kick",
        type: "clip",
        channelName: "xqc",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Removed clip" }));

    await screen.findByText("Removed clip");
    expect(removeFromHistory).toHaveBeenCalledWith("kick-clip-c1");
  });

  it("removes a video history item when playback verification fails", async () => {
    vi.mocked(window.electronAPI.videos.getPlaybackUrl).mockResolvedValue({
      success: false,
      error: "Video not found",
    });
    mockHistory = [
      {
        id: "twitch-video-v1",
        originalId: "v1",
        title: "Removed VOD",
        platform: "twitch",
        type: "video",
        channelName: "ninja",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Removed VOD" }));

    await screen.findByText("Removed VOD");
    expect(removeFromHistory).toHaveBeenCalledWith("twitch-video-v1");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refreshes Twitch video playback instead of reusing a stored signed URL", async () => {
    mockHistory = [
      {
        id: "twitch-video-v1",
        originalId: "v1",
        title: "Signed VOD",
        platform: "twitch",
        type: "video",
        channelName: "ninja",
        playbackUrl: "https://usher.ttvnw.net/vod/v1.m3u8?expired=true",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Signed VOD" }));

    await screen.findByText("Signed VOD");
    expect(window.electronAPI.videos.getPlaybackUrl).toHaveBeenCalledWith({
      platform: "twitch",
      videoId: "v1",
    });
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/video/$platform/$videoId",
        search: expect.objectContaining({ src: undefined }),
      })
    );
  });

  it("keeps direct Kick video playback URLs from history", async () => {
    mockHistory = [
      {
        id: "kick-video-v1",
        originalId: "v1",
        title: "Kick VOD",
        platform: "kick",
        type: "video",
        channelName: "xqc",
        playbackUrl: "https://stream.kick.com/archive/master.m3u8",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Kick VOD" }));

    await screen.findByText("Kick VOD");
    expect(window.electronAPI.videos.getPlaybackUrl).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/video/$platform/$videoId",
        search: expect.objectContaining({
          src: "https://stream.kick.com/archive/master.m3u8",
        }),
      })
    );
  });

  it("links stream history items to the streamer Home tab by default", () => {
    mockHistory = [
      {
        id: "3",
        originalId: "s1",
        title: "Live stream",
        platform: "twitch",
        type: "stream",
        channelName: "ninja",
        timestamp: Date.now(),
      },
    ];

    renderWithProviders(<HistoryPage />);

    const link = screen.getByText("Live stream").closest("a");
    expect(link).toHaveAttribute("data-to", "/stream/$platform/$channel");
    expect(link).toHaveAttribute(
      "data-params",
      JSON.stringify({ platform: "twitch", channel: "ninja" })
    );
    expect(link).toHaveAttribute("data-search", JSON.stringify({ tab: "home" }));
  });

  it("calls clearHistory after the confirm dialog", () => {
    mockHistory = [
      {
        id: "1",
        originalId: "v1",
        title: "X",
        platform: "twitch",
        type: "video",
        channelName: "a",
        timestamp: Date.now(),
      },
    ];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /clear history/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(clearHistory).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("skips clearHistory if the confirm is dismissed", () => {
    mockHistory = [
      {
        id: "1",
        originalId: "v1",
        title: "X",
        platform: "twitch",
        type: "video",
        channelName: "a",
        timestamp: Date.now(),
      },
    ];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /clear history/i }));
    expect(clearHistory).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
