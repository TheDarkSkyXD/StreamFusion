import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatReplayRail } from "@/components/chat-replay/chat-replay-rail";
import type { ChatReplayWindowResult } from "@/shared/chat-replay-types";

const supportedReplay: ChatReplayWindowResult = {
  capability: "supported",
  platform: "twitch",
  videoId: "video-1",
  messages: [10, 20, 40].map((offsetSeconds) => ({
    id: `message-${offsetSeconds}`,
    offsetSeconds,
    sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
    badges: [],
    fragments: [{ type: "text", text: `Message at ${offsetSeconds}` }],
  })),
  nextCursor: null,
  hasNextPage: false,
};

function decodeProxiedImageSource(image: HTMLElement): string {
  const source = image.getAttribute("src") ?? "";
  const encoded = new URL(source).searchParams.get("u") ?? "";
  return atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
}

// Guards: unsupported Videos do not advertise Chat Replay or surface an error rail
// Guards: browsing older messages must not seek or pause Video playback
// Guards: only explicit replay timestamp controls seek the Video
// Guards: historical rich messages remain readable without send or moderation actions
// Guards: archived sender colors use the same theme-readable username presentation as live chat
// Guards: replay badges render adapter-resolved provider images and human-readable titles
// Guards: replay emotes use normalized adapter URLs instead of renderer-side provider guesses
// Guards: replay media rejects non-provider hosts before creating image or proxy requests
// Guards: desktop viewers can collapse and restore the replay rail without losing the Video
// Guards: an empty replay window is explicit without claiming the entire Video archive has no chat
// Guards: narrow replay drawers contain long usernames and unbroken messages without horizontal scrolling
describe("Chat Replay rail", () => {
  it("collapses to a compact desktop control and restores the replay rail", () => {
    render(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse Chat Replay" }));

    expect(screen.queryByRole("log", { name: "Chat Replay messages" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Chat Replay" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Chat Replay" }));

    expect(screen.getByRole("log", { name: "Chat Replay messages" })).toBeInTheDocument();
  });

  it("renders nothing when the Platform adapter reports the Video unsupported", () => {
    const { container } = render(
      <ChatReplayRail
        result={{ capability: "unsupported", platform: "twitch", videoId: "video-1" }}
        playback={{ currentTime: 0, isPlaying: false, playbackRate: 1 }}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/chat replay/i)).not.toBeInTheDocument();
  });

  it("describes an empty replay window without making an archive-wide claim", () => {
    render(
      <ChatReplayRail
        result={{ capability: "empty", platform: "twitch", videoId: "video-1" }}
        playback={{ currentTime: 0, isPlaying: false, playbackRate: 1 }}
      />
    );

    expect(screen.getByRole("status", { name: "Chat Replay window empty" })).toHaveTextContent(
      "No archived messages were found near this point."
    );
    expect(screen.queryByText("No messages at this moment.")).not.toBeInTheDocument();
  });

  it("keeps hook order stable while capability changes hide and restore the rail", () => {
    const { rerender } = render(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
      />
    );
    expect(screen.getByRole("complementary", { name: "Chat Replay" })).toBeInTheDocument();

    rerender(
      <ChatReplayRail
        result={{ capability: "unsupported", platform: "twitch", videoId: "video-1" }}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
      />
    );
    expect(screen.queryByRole("complementary", { name: "Chat Replay" })).not.toBeInTheDocument();

    rerender(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
      />
    );
    expect(screen.getByRole("log", { name: "Chat Replay messages" })).toBeInTheDocument();
  });

  it("suspends auto-follow when the viewer scrolls away without controlling the Video", () => {
    const onSeek = vi.fn();
    const { rerender } = render(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
        onSeek={onSeek}
      />
    );
    const messageLog = screen.getByRole("log", { name: "Chat Replay messages" });
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    fireEvent.scroll(messageLog);
    rerender(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 45, isPlaying: true, playbackRate: 1 }}
        onSeek={onSeek}
      />
    );

    expect(screen.getByText("Message at 20")).toBeInTheDocument();
    expect(screen.queryByText("Message at 40")).not.toBeInTheDocument();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("keeps the replay log pinned to its newest message while auto-follow is active", () => {
    const { rerender } = render(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 10, isPlaying: true, playbackRate: 1 }}
      />
    );
    const messageLog = screen.getByRole("log", { name: "Chat Replay messages" });
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 300 },
    });

    rerender(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
      />
    );

    expect(messageLog.scrollTop).toBe(500);
  });

  it("labels the return control with playback time and restores the current replay window", () => {
    const { rerender } = render(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
      />
    );
    const messageLog = screen.getByRole("log", { name: "Chat Replay messages" });
    Object.defineProperties(messageLog, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(messageLog);
    rerender(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 45, isPlaying: true, playbackRate: 1 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Return to 0:45" }));

    expect(screen.getByText("Message at 40")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /return to/i })).not.toBeInTheDocument();
  });

  it("seeks from a message timestamp without making the message body seekable", () => {
    const onSeek = vi.fn();
    render(
      <ChatReplayRail
        result={supportedReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
        onSeek={onSeek}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Seek to 0:20" }));
    fireEvent.click(screen.getByText("Message at 20"));

    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(20);
  });

  it("presents an archived sender's historical color through the live-chat username behavior", () => {
    const coloredReplay = {
      ...supportedReplay,
      messages: [
        {
          ...supportedReplay.messages[0],
          sender: {
            ...supportedReplay.messages[0].sender,
            color: "#ff0000",
          },
        },
      ],
    } as ChatReplayWindowResult;

    render(
      <ChatReplayRail
        result={coloredReplay}
        playback={{ currentTime: 10, isPlaying: true, playbackRate: 1 }}
      />
    );

    expect(screen.getByText("Viewer")).toHaveStyle({ color: "rgb(255, 0, 0)" });
  });

  it("assigns deterministic readable colors when archived senders have no historical color", () => {
    const uncoloredReplay = {
      ...supportedReplay,
      messages: [
        {
          ...supportedReplay.messages[0],
          sender: { id: "alpha", login: "alpha", displayName: "Alpha" },
        },
        {
          ...supportedReplay.messages[1],
          sender: { id: "omega", login: "omega-zzz", displayName: "Omega" },
        },
      ],
    } as ChatReplayWindowResult;

    render(
      <ChatReplayRail
        result={uncoloredReplay}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
      />
    );

    const alphaColor = screen.getByText("Alpha").style.color;
    const omegaColor = screen.getByText("Omega").style.color;
    expect(alphaColor).not.toBe("");
    expect(omegaColor).not.toBe("");
    expect(alphaColor).not.toBe(omegaColor);
  });

  it("renders a provider-resolved badge image and title", () => {
    const kickReplay = {
      capability: "supported",
      platform: "kick",
      videoId: "video-1",
      messages: [
        {
          id: "kick-message",
          offsetSeconds: 5,
          sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
          badges: [
            {
              id: "moderator",
              setId: "moderator",
              version: "1",
              imageUrl: "https://ext.cdn.kick.com/chat/badges/moderator.png",
              title: "Moderator",
            },
          ],
          fragments: [{ type: "text", text: "Hello" }],
        },
      ],
      nextCursor: null,
      hasNextPage: false,
    } as ChatReplayWindowResult;

    render(
      <ChatReplayRail
        result={kickReplay}
        playback={{ currentTime: 5, isPlaying: true, playbackRate: 1 }}
      />
    );

    const badge = screen.getByRole("img", { name: "Moderator" });
    expect(badge.parentElement).toHaveAttribute("title", "Moderator");
    expect(badge.getAttribute("src")).toMatch(/^kick-image:\/\/image\?u=/);
    expect(decodeProxiedImageSource(badge)).toBe(
      "https://ext.cdn.kick.com/chat/badges/moderator.png"
    );
  });

  it("renders an emote from its normalized adapter URL", () => {
    const kickReplay = {
      capability: "supported",
      platform: "kick",
      videoId: "video-1",
      messages: [
        {
          id: "kick-message",
          offsetSeconds: 5,
          sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
          badges: [],
          fragments: [
            {
              type: "emote",
              text: "KICKLove",
              emoteId: "123",
              url: "https://files.kick.com/emotes/123/fullsize",
            },
          ],
        },
      ],
      nextCursor: null,
      hasNextPage: false,
    } as ChatReplayWindowResult;

    render(
      <ChatReplayRail
        result={kickReplay}
        playback={{ currentTime: 5, isPlaying: true, playbackRate: 1 }}
      />
    );

    const emote = screen.getByRole("img", { name: "KICKLove" });
    expect(emote.getAttribute("src")).toMatch(/^kick-image:\/\/image\?u=/);
    expect(decodeProxiedImageSource(emote)).toBe("https://files.kick.com/emotes/123/fullsize");
  });

  it("rejects replay badge and emote URLs outside each Platform allowlist", () => {
    const twitchReplay = {
      capability: "supported",
      platform: "twitch",
      videoId: "video-1",
      messages: [
        {
          id: "twitch-message",
          offsetSeconds: 5,
          sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
          badges: [
            {
              id: "subscriber",
              setId: "subscriber",
              version: "1",
              imageUrl: "https://static-cdn.jtvnw.net.attacker.test/badge.png",
              title: "Subscriber",
            },
          ],
          fragments: [{ type: "text", text: "Hello" }],
        },
      ],
      nextCursor: null,
      hasNextPage: false,
    } as ChatReplayWindowResult;
    const kickReplay = {
      capability: "supported",
      platform: "kick",
      videoId: "video-1",
      messages: [
        {
          id: "kick-message",
          offsetSeconds: 5,
          sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
          badges: [],
          fragments: [
            {
              type: "emote",
              text: "KICKLove",
              emoteId: "123",
              url: "https://files.kick.com.attacker.test/emote.png",
            },
          ],
        },
      ],
      nextCursor: null,
      hasNextPage: false,
    } as ChatReplayWindowResult;

    const { rerender } = render(
      <ChatReplayRail
        result={twitchReplay}
        playback={{ currentTime: 5, isPlaying: true, playbackRate: 1 }}
      />
    );

    expect(screen.queryByRole("img", { name: "Subscriber" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Subscriber unavailable")).toBeInTheDocument();

    rerender(
      <ChatReplayRail
        result={kickReplay}
        playback={{ currentTime: 5, isPlaying: true, playbackRate: 1 }}
      />
    );

    expect(screen.queryByRole("img", { name: "KICKLove" })).not.toBeInTheDocument();
    expect(screen.getByText("KICKLove")).toBeInTheDocument();
  });

  it("contains long usernames and messages inside a 320px drawer", () => {
    const longUsername = "this_is_a_very_long_archived_username_that_must_not_expand_the_row";
    const longMessage = "unbroken-message-".repeat(24);
    render(
      <div style={{ width: 320 }}>
        <ChatReplayRail
          result={{
            capability: "supported",
            platform: "twitch",
            videoId: "video-1",
            messages: [
              {
                id: "long-message",
                offsetSeconds: 15,
                sender: {
                  id: "sender-1",
                  login: longUsername,
                  displayName: longUsername,
                },
                badges: [],
                fragments: [{ type: "text", text: longMessage }],
              },
            ],
            nextCursor: null,
            hasNextPage: false,
          }}
          playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
          presentation="drawer"
        />
      </div>
    );

    const messageLog = screen.getByRole("log", { name: "Chat Replay messages" });
    const usernameControl = screen.getByRole("button", { name: longUsername });
    const usernameSlot = usernameControl.parentElement?.parentElement;
    const messageBody = screen.getByText(longMessage);

    expect(messageLog).toHaveClass("min-w-0", "overflow-x-hidden");
    expect(usernameSlot).toHaveClass("min-w-0", "flex-1", "overflow-hidden");
    expect(messageBody).toHaveClass("min-w-0", "max-w-full", "[overflow-wrap:anywhere]");
  });

  it("renders rich historical messages and lightweight user details as read-only content", () => {
    const onSeek = vi.fn();
    render(
      <ChatReplayRail
        result={{
          capability: "supported",
          platform: "twitch",
          videoId: "video-1",
          messages: [
            {
              id: "rich-message",
              offsetSeconds: 15,
              sender: { id: "sender-1", login: "viewer", displayName: "Replay Viewer" },
              badges: [
                {
                  id: "badge-1",
                  setId: "subscriber",
                  version: "12",
                  imageUrl: "https://static-cdn.jtvnw.net/badges/v1/badge-1/1",
                  title: "Subscriber",
                },
              ],
              fragments: [
                { type: "text", text: "Hello @friend, see https://example.com " },
                {
                  type: "emote",
                  text: "Kappa",
                  emoteId: "25",
                  url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0",
                },
              ],
            },
          ],
          nextCursor: null,
          hasNextPage: false,
        }}
        playback={{ currentTime: 20, isPlaying: true, playbackRate: 1 }}
        onSeek={onSeek}
      />
    );

    const badge = screen.getByRole("img", { name: "Subscriber" });
    expect(badge.getAttribute("src")).toMatch(/^twitch-image:\/\/image\?u=/);
    expect(decodeProxiedImageSource(badge)).toBe(
      "https://static-cdn.jtvnw.net/badges/v1/badge-1/1"
    );
    const emote = screen.getByRole("img", { name: "Kappa" });
    expect(emote.getAttribute("src")).toMatch(/^twitch-image:\/\/image\?u=/);
    expect(decodeProxiedImageSource(emote)).toBe(
      "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0"
    );
    expect(screen.getByLabelText("Mention @friend")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://example.com" });
    expect(link).toHaveAttribute("href", "https://example.com");

    fireEvent.click(screen.getByRole("button", { name: "Replay Viewer" }));
    expect(screen.getByText("@viewer")).toBeInTheDocument();
    fireEvent.click(link);

    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ban|timeout|moderate|send/i })
    ).not.toBeInTheDocument();
  });
});
