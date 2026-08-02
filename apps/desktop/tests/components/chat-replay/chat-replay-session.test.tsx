import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatReplaySession } from "@/components/chat-replay/chat-replay-session";
import { createChatReplayPlaybackStore } from "@/hooks/chat-replay-playback-store";
import { clearChatReplayWindowCache } from "@/hooks/use-chat-replay";
import { installElectronAPIMock } from "../../test-utils";

// Guards: narrow Video layouts expose replay as a non-modal drawer that leaves player controls reachable
// Guards: supported replay checks render a labelled skeleton instead of a blank rail
// Guards: transient replay failures stay inline and Retry can recover the current window
// Guards: narrow loading and failure states remain available inside the replay drawer
// Guards: source capability loss removes replay instead of becoming a generic error panel
describe("ChatReplaySession", () => {
  beforeEach(() => {
    clearChatReplayWindowCache();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  });

  it("shows a labelled replay skeleton while capability data is loading", () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn(() => new Promise(() => undefined));
    const playbackStore = createChatReplayPlaybackStore();

    render(<ChatReplaySession platform="twitch" videoId="video-1" playbackStore={playbackStore} />);

    expect(screen.getByRole("status", { name: "Loading Chat Replay" })).toBeInTheDocument();
  });

  it("renders replay capability for Kick VODs", async () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: { capability: "empty", platform: "kick", videoId: "video-1" },
    });
    const playbackStore = createChatReplayPlaybackStore();

    render(<ChatReplaySession platform="kick" videoId="video-1" playbackStore={playbackStore} />);

    expect(
      await screen.findByRole("status", { name: "Chat Replay window empty" })
    ).toBeInTheDocument();
  });

  it("forwards Kick replay locator metadata to the replay request", async () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: { capability: "empty", platform: "kick", videoId: "video-1" },
    });
    const playbackStore = createChatReplayPlaybackStore();
    const locator = { channelId: "channel-42", startedAt: "2026-07-17T12:30:00.000Z" };

    render(
      <ChatReplaySession
        platform="kick"
        videoId="video-1"
        playbackStore={playbackStore}
        locator={locator}
      />
    );

    await waitFor(() => {
      expect(api.videos.getChatReplayWindow).toHaveBeenCalledWith(
        expect.objectContaining({ locator })
      );
    });
  });

  it("offers inline Retry after a transient failure and recovers the replay", async () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: {
          capability: "transient-failure",
          platform: "twitch",
          videoId: "video-1",
          reason: "Replay source temporarily unavailable",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          capability: "supported",
          platform: "twitch",
          videoId: "video-1",
          messages: [
            {
              id: "message-after-retry",
              offsetSeconds: 0,
              sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
              badges: [],
              fragments: [{ type: "text", text: "Replay recovered" }],
            },
          ],
          nextCursor: null,
          hasNextPage: false,
        },
      });
    const playbackStore = createChatReplayPlaybackStore();

    render(<ChatReplaySession platform="twitch" videoId="video-1" playbackStore={playbackStore} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Replay source temporarily unavailable"
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry Chat Replay" }));

    expect(await screen.findByText("Replay recovered")).toBeInTheDocument();
    expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(2);
  });

  it("keeps a retryable failure available in the narrow replay drawer", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: {
        capability: "transient-failure",
        platform: "twitch",
        videoId: "video-1",
        reason: "Replay service is busy",
      },
    });
    const playbackStore = createChatReplayPlaybackStore();

    render(<ChatReplaySession platform="twitch" videoId="video-1" playbackStore={playbackStore} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Chat Replay" }));

    expect(screen.getByRole("dialog", { name: "Chat Replay drawer" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Replay service is busy");
    expect(screen.getByRole("button", { name: "Close Chat Replay" })).toBeInTheDocument();
  });

  it("removes the replay cleanly when a later playback window loses capability", async () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: {
          capability: "empty",
          platform: "twitch",
          videoId: "video-1",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          capability: "unsupported",
          platform: "twitch",
          videoId: "video-1",
        },
      });
    const playbackStore = createChatReplayPlaybackStore();
    render(<ChatReplaySession platform="twitch" videoId="video-1" playbackStore={playbackStore} />);

    expect(
      await screen.findByRole("status", { name: "Chat Replay window empty" })
    ).toBeInTheDocument();

    act(() => {
      playbackStore.publish({ currentTime: 130, isPlaying: true, playbackRate: 1 });
    });

    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: "Chat Replay" })).not.toBeInTheDocument();
    });
    expect(api.videos.getChatReplayWindow).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens an accessible in-flow drawer at narrow widths without trapping Video controls", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: {
        capability: "empty",
        platform: "twitch",
        videoId: "video-1",
      },
    });
    const playbackStore = createChatReplayPlaybackStore();

    render(
      <div>
        <button type="button">Video controls</button>
        <ChatReplaySession platform="twitch" videoId="video-1" playbackStore={playbackStore} />
      </div>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open Chat Replay" }));

    const drawer = screen.getByRole("dialog", { name: "Chat Replay drawer" });
    expect(drawer).toHaveAttribute("aria-modal", "false");
    screen.getByRole("button", { name: "Video controls" }).focus();
    expect(screen.getByRole("button", { name: "Video controls" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Close Chat Replay" }));
    expect(screen.queryByRole("dialog", { name: "Chat Replay drawer" })).not.toBeInTheDocument();
  });

  it("renders a supported replay and follows playback snapshots", async () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: {
        capability: "supported",
        platform: "twitch",
        videoId: "video-1",
        messages: [
          {
            id: "message-1",
            offsetSeconds: 12,
            sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
            badges: [],
            fragments: [{ type: "text", text: "Synchronized message" }],
          },
        ],
        nextCursor: null,
        hasNextPage: false,
      },
    });
    const playbackStore = createChatReplayPlaybackStore();
    render(<ChatReplaySession platform="twitch" videoId="video-1" playbackStore={playbackStore} />);

    expect(screen.getByRole("status", { name: "Loading Chat Replay" })).toBeInTheDocument();
    expect(await screen.findByRole("log", { name: "Chat Replay messages" })).toBeInTheDocument();
    expect(screen.queryByText("Synchronized message")).not.toBeInTheDocument();

    act(() => {
      playbackStore.publish({ currentTime: 20, isPlaying: true, playbackRate: 2 });
    });

    await waitFor(() => expect(screen.getByText("Synchronized message")).toBeInTheDocument());
    expect(screen.getByText("0:20")).toBeInTheDocument();
  });

  it("routes timestamp seeks through the shared playback coordinator", async () => {
    const api = installElectronAPIMock();
    api.videos.cancelChatReplayWindow = vi.fn().mockResolvedValue({ cancelled: false });
    api.videos.getChatReplayWindow = vi.fn().mockResolvedValue({
      success: true,
      data: {
        capability: "supported",
        platform: "twitch",
        videoId: "video-1",
        messages: [
          {
            id: "message-1",
            offsetSeconds: 12.75,
            sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
            badges: [],
            fragments: [{ type: "text", text: "Seek here" }],
          },
        ],
        nextCursor: null,
        hasNextPage: false,
      },
    });
    const playbackStore = createChatReplayPlaybackStore();
    const seekVideo = vi.fn();
    playbackStore.subscribeToSeek(seekVideo);
    playbackStore.publish({ currentTime: 20, isPlaying: true, playbackRate: 1 });
    render(<ChatReplaySession platform="twitch" videoId="video-1" playbackStore={playbackStore} />);

    fireEvent.click(await screen.findByRole("button", { name: "Seek to 0:12" }));

    expect(seekVideo).toHaveBeenCalledWith(12.75);
  });
});
