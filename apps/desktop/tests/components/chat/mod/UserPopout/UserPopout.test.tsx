import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock the profile fetcher BEFORE importing the popout — the hook runs an
// effect on mount and we don't want it touching the network.
vi.mock("@/components/chat/mod/UserPopout/useUserProfile", () => {
  return {
    useUserProfile: vi.fn(),
  };
});

// Mock the mod-log hook the inner UserModHistory consumes so it doesn't
// reach into the real database singleton.
vi.mock("@/hooks/useModLog", () => ({
  useModLog: () => ({ entries: [], loading: false }),
}));

import { UserPopout } from "@/components/chat/mod/UserPopout/UserPopout";
import { useUserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import type { ChatMessage } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

const mockedUseUserProfile = vi.mocked(useUserProfile);

function pendingProfileState() {
  return {
    profile: null,
    loading: true,
    error: null,
    identity: { state: "loading" as const },
    accountCreated: { state: "loading" as const },
    follow: { state: "loading" as const },
    channel: { state: "loading" as const },
    retryIdentity: vi.fn(),
    retryAccountCreated: vi.fn(),
    retryFollow: vi.fn(),
    retryChannel: vi.fn(),
  };
}

beforeEach(() => {
  mockedUseUserProfile.mockReset();
  useChatStore.setState({ messagesByChannel: {} });
  useAuthStore.setState((state) => ({
    preferences: {
      ...(state.preferences ?? {}),
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
    } as typeof state.preferences,
  }));
  // Stub the electronAPI for openExternal usage inside the footer.
  (globalThis as any).window.electronAPI = {
    openExternal: vi.fn(),
    auth: { getToken: vi.fn().mockResolvedValue(null) },
  };
});

function makeMessage(id: string, channel: string, rawContent: string): ChatMessage {
  return {
    id,
    platform: "twitch",
    type: "message",
    channel,
    userId: "u1",
    username: "alice",
    displayName: "Alice",
    color: "#fff",
    badges: [],
    content: [{ type: "text", content: rawContent }],
    rawContent,
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

function renderPopout(
  open = true,
  platform: "twitch" | "kick" = "twitch",
  avatarUrl?: string,
  username = "alice",
  openingMessage?: ChatMessage,
  badgeCatalog?: {
    state: "loading" | "ready" | "failed";
    sourceLabel: string;
    retry: () => void;
  }
) {
  return render(
    <TooltipProvider>
      <UserPopout
        userId="u1"
        username={username}
        avatarUrl={avatarUrl}
        platform={platform}
        channelId="c1"
        channelSlug="streamer"
        openingMessage={openingMessage}
        badgeCatalog={badgeCatalog}
        open={open}
        onOpenChange={() => {}}
      />
    </TooltipProvider>
  );
}

// Guards: failed remote identity keeps chat-known identity visible and exposes a field-level retry.
// Guards: identity loading remains visible without delaying the dialog shell.
// Guards: Kick user dialogs keep Kick-specific accessible copy and external profile navigation.
// Guards: Recent chat stays channel-scoped, rich, author-truthful, and capped at four row badges.
// Guards: Exact selected-message targets survive live insertion/pruning and change only deliberately.
// Guards: Live matching inserts respect reduced motion and badge catalog states stay independently truthful.
describe("UserPopout", () => {
  it("keeps the verified-empty current-chat section visible with exact copy", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", undefined, {
      state: "failed",
      sourceLabel: "Twitch · Live chat",
      retry: vi.fn(),
    });

    expect(screen.getByRole("heading", { name: "Recent in this chat" })).toBeInTheDocument();
    expect(screen.getByText("No recent messages in this chat")).toBeInTheDocument();
    expect(screen.getByText("No badges on the latest message")).toBeInTheDocument();
  });

  it("uses the normal rich renderer, preserves reply authors, and caps row badges at four", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const authored = {
      ...makeMessage("authored", "streamer", "hello Kappa"),
      badges: Array.from({ length: 6 }, (_, index) => ({
        setId: `badge-${index}`,
        version: "1",
        imageUrl: `https://example.com/badge-${index}.png`,
        title: `Badge ${index}`,
      })),
      content: [
        { type: "text" as const, content: "hello " },
        {
          type: "emote" as const,
          id: "25",
          name: "Kappa",
          url: "https://example.com/kappa.png",
        },
      ],
    };
    const reply = {
      ...makeMessage("reply", "streamer", "reply from Bob"),
      userId: "u2",
      username: "bob",
      displayName: "Bob",
      replyTo: {
        parentMessageId: authored.id,
        parentUserId: "u1",
        parentUsername: "alice",
        parentDisplayName: "Alice",
        parentMessageBody: authored.rawContent,
      },
    };
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [authored, reply],
      },
    });

    renderPopout(true, "twitch", undefined, "alice", undefined, {
      state: "failed",
      sourceLabel: "Twitch · Live chat",
      retry: vi.fn(),
    });

    const rows = within(screen.getByTestId("user-popout-recent-messages"));
    expect(rows.getByText("Alice")).toBeInTheDocument();
    expect(rows.getByText("Bob")).toBeInTheDocument();
    expect(rows.getByTestId("chat-message-reply-preview")).toHaveTextContent(
      "Replying to @Alice: hello Kappa"
    );
    expect(rows.getByRole("button", { name: "Show Kappa emote details" })).toBeInTheDocument();
    expect(rows.getAllByRole("img", { name: /^Badge / })).toHaveLength(4);
    expect(
      within(screen.getByTestId("user-profile-badges")).getAllByRole("img", {
        name: /^Badge \d$/,
      })
    ).toHaveLength(6);
  });

  it("keeps badge-source failure distinct and Retry requests a real channel reconnect", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const retry = vi.fn();

    renderPopout(true, "twitch", undefined, "alice", undefined, {
      state: "failed",
      sourceLabel: "Twitch · Live chat",
      retry,
    });
    fireEvent.click(screen.getByRole("button", { name: "Couldn’t load badges · Retry" }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders retained deleted rows with the viewer's selected deleted-message preference", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    useAuthStore.setState((state) => ({
      preferences: {
        ...(state.preferences ?? {}),
        chatDisplay: {
          ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
          deletedMessageDisplay: "audit",
        },
      } as typeof state.preferences,
    }));
    const deleted = {
      ...makeMessage("deleted", "streamer", "retained deleted content"),
      isDeleted: true,
      deletedByUsername: "modbot",
    };
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [deleted],
      },
    });

    renderPopout();

    expect(screen.getByTestId("deleted-message-highlight")).toBeInTheDocument();
    expect(screen.getByText("retained deleted content")).toBeInTheDocument();
    expect(screen.getByText(/Twitch - id deleted/)).toBeInTheDocument();
  });

  it("keeps a deliberately selected exact message pinned through live insertion and pruning", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const openingMessage = makeMessage("opening", "streamer", "opening message");
    const reply = {
      ...makeMessage("reply", "streamer", "reply from Bob"),
      userId: "u2",
      username: "bob",
      displayName: "Bob",
      replyTo: {
        parentMessageId: openingMessage.id,
        parentUserId: openingMessage.userId,
        parentUsername: openingMessage.username,
        parentDisplayName: openingMessage.displayName,
        parentMessageBody: openingMessage.rawContent,
      },
    };
    const channelKey = buildChannelKey("twitch", "streamer");
    useChatStore.setState({
      messagesByChannel: { [channelKey]: [openingMessage, reply] },
    });

    renderPopout(true, "twitch", undefined, "alice", openingMessage);
    const selectedFooter = screen.getByTestId("user-popout-selected-footer");
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", openingMessage.id);

    fireEvent.click(
      screen.getByRole("button", { name: "Select message from Bob: reply from Bob" })
    );
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", reply.id);
    expect(selectedFooter).toHaveAttribute("data-selected-author-id", reply.userId);
    expect(selectedFooter).toHaveAttribute("data-selected-platform", reply.platform);
    expect(selectedFooter).toHaveAttribute("data-selected-channel", reply.channel);

    act(() => {
      useChatStore.setState({
        messagesByChannel: {
          [channelKey]: Array.from({ length: 11 }, (_, index) =>
            makeMessage(`new-${index}`, "streamer", `new message ${index}`)
          ),
        },
      });
    });

    expect(screen.queryByText("reply from Bob")).toBeNull();
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", reply.id);
    expect(selectedFooter).toHaveAttribute("data-selected-author-id", reply.userId);
    expect(selectedFooter).toHaveAttribute("data-selected-platform", reply.platform);
    expect(selectedFooter).toHaveAttribute("data-selected-channel", reply.channel);
  });

  it("selects rows by keyboard and scrolls live inserts without motion when requested", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    const channelKey = buildChannelKey("twitch", "streamer");
    const first = makeMessage("first", "streamer", "first message");
    const second = makeMessage("second", "streamer", "second message");
    useChatStore.setState({ messagesByChannel: { [channelKey]: [first, second] } });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    renderPopout(true, "twitch", undefined, "alice", first);
    const selectedFooter = screen.getByTestId("user-popout-selected-footer");
    const secondRowSelector = screen.getByRole("button", {
      name: "Select message from Alice: second message",
    });
    fireEvent.keyDown(secondRowSelector, { key: "Enter" });
    expect(selectedFooter).toHaveAttribute("data-selected-message-id", second.id);

    scrollIntoView.mockClear();
    act(() => {
      useChatStore.setState({
        messagesByChannel: {
          [channelKey]: [first, second, makeMessage("third", "streamer", "third message")],
        },
      });
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "nearest" });
  });

  it("opens immediately with chat-known identity while remote fields load", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    renderPopout();
    expect(screen.getByTestId("user-popout")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "alice" })).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Profile loading…")).toBeInTheDocument();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Open alice on Twitch" })).toBeInTheDocument();
    expect(screen.getByText("Channel loading…")).toBeInTheDocument();
  });

  it("keeps chat-known identity visible and offers Retry when identity cannot be verified", () => {
    const retryIdentity = vi.fn();
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      loading: false,
      identity: { state: "failed", message: "Couldn’t verify" },
      error: "Couldn’t verify",
      accountCreated: { state: "failed", message: "Couldn’t verify" },
      retryIdentity,
    });
    renderPopout();
    expect(screen.getByRole("heading", { name: "alice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Profile unavailable · Retry" }));
    expect(retryIdentity).toHaveBeenCalledTimes(1);
  });

  it("renders the identity-first public profile without moderation controls", () => {
    mockedUseUserProfile.mockReturnValue({
      profile: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
        createdAt: "2020-01-01T00:00:00Z",
        followSince: null,
        subscription: null,
        isFounder: false,
        isVip: false,
        isMod: false,
      },
      loading: false,
      error: null,
      identity: {
        state: "known",
        source: "official",
        value: {
          userId: "u1",
          username: "alice",
          displayName: "Alice",
          avatarUrl: "",
        },
      },
      accountCreated: {
        state: "known",
        source: "first-party-fallback",
        value: "2020-01-01T00:00:00Z",
      },
      follow: { state: "negative", source: "official" },
      channel: {
        state: "known",
        source: "official",
        value: { id: "c1", username: "streamer", displayName: "Streamer" },
      },
      retryIdentity: vi.fn(),
      retryAccountCreated: vi.fn(),
      retryFollow: vi.fn(),
      retryChannel: vi.fn(),
    });
    renderPopout();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Not following")).toBeInTheDocument();
    expect(screen.queryByTestId("user-popout-footer")).toBeNull();
    expect(screen.queryByText(/Mod history/i)).toBeNull();
    expect(screen.getByTestId("user-popout")).toHaveClass(
      "w-[calc(100vw-2rem)]",
      "max-w-[560px]",
      "max-h-[80vh]"
    );
    expect(screen.getByTestId("user-popout-body")).toHaveClass("overflow-y-auto");
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("shows recent messages from the current channel bucket only", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      profile: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
        createdAt: "2020-01-01T00:00:00Z",
        followSince: null,
        subscription: null,
        isFounder: false,
        isVip: false,
        isMod: false,
      },
      loading: false,
      error: null,
      identity: {
        state: "known",
        source: "official",
        value: {
          userId: "u1",
          username: "alice",
          displayName: "Alice",
          avatarUrl: "",
        },
      },
      accountCreated: {
        state: "known",
        source: "first-party-fallback",
        value: "2020-01-01T00:00:00Z",
      },
    });
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey("twitch", "streamer")]: [
          makeMessage("current", "streamer", "right channel"),
        ],
        [buildChannelKey("twitch", "other")]: [makeMessage("other", "other", "wrong channel")],
      },
    });

    renderPopout();

    expect(screen.getByText("right channel")).toBeInTheDocument();
    expect(screen.queryByText("wrong channel")).toBeNull();
  });

  it("renders nothing in the document body when open=false", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());
    renderPopout(false);
    expect(screen.queryByTestId("user-popout")).toBeNull();
    expect(screen.queryByTestId("user-popout-skeleton")).toBeNull();
  });

  it("renders compactly in a short viewport", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    mockedUseUserProfile.mockReturnValue(pendingProfileState());

    renderPopout();
    fireEvent(window, new Event("resize"));

    await waitFor(() =>
      expect(screen.getByTestId("user-popout")).toHaveAttribute("data-compact", "true")
    );
    expect(screen.getByTestId("user-popout")).toHaveClass("max-h-[calc(100vh-1rem)]");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  });

  it("keeps channel loading and failure independent, then retries only the channel", () => {
    const retryChannel = vi.fn();
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: { state: "failed", message: "Unavailable" },
      retryChannel,
    });

    renderPopout();
    fireEvent.click(screen.getByRole("button", { name: "Open alice on Twitch" }));
    fireEvent.click(screen.getByRole("button", { name: "Channel unavailable · Retry" }));

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://www.twitch.tv/alice");
    expect(retryChannel).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "alice" })).toBeInTheDocument();
  });

  it("opens the clicked chatter channel rather than the current stream channel", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: {
        state: "known",
        source: "official",
        value: { id: "u1", username: "alice", displayName: "Alice" },
      },
    });

    renderPopout();
    fireEvent.click(screen.getByRole("button", { name: "Open Alice on Twitch" }));

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://www.twitch.tv/alice");
  });

  it("preserves the Kick dialog path and opens the clicked user on Kick", () => {
    mockedUseUserProfile.mockReturnValue(pendingProfileState());

    renderPopout(true, "kick");
    fireEvent.click(screen.getByRole("button", { name: "Open alice on Kick" }));

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://kick.com/alice");
    expect(
      screen.getByText("Public Kick profile and recent messages for @alice.")
    ).toBeInTheDocument();
  });

  it.each([
    "unavailable",
    "failed",
  ] as const)("keeps the chat-known Kick profile link available when channel enrichment is %s", (channelState) => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      channel: { state: channelState, message: "Unavailable" },
    });

    renderPopout(true, "kick", undefined, "AntithesisOfSpace");
    fireEvent.click(screen.getByRole("button", { name: "Open AntithesisOfSpace on Kick" }));

    expect(window.electronAPI.openExternal).toHaveBeenCalledWith(
      "https://kick.com/antithesisofspace"
    );
    expect(screen.getByRole("button", { name: "Channel unavailable · Retry" })).toBeEnabled();
  });

  it("preserves a chat-event Kick avatar when official enrichment has no avatar", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      loading: false,
      identity: {
        state: "known",
        source: "official",
        value: {
          userId: "u1",
          username: "alice",
          displayName: "Alice",
          avatarUrl: "",
        },
      },
    });

    renderPopout(true, "kick", "https://files.kick.com/chat-avatar.webp");

    expect(screen.getByRole("img", { name: "Alice avatar" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Alice avatar unavailable" })).toBeNull();
  });

  it("announces failed remote fields politely", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      accountCreated: { state: "failed", message: "Couldn’t verify" },
      follow: { state: "reconnect-required", missingScopes: ["moderator:read:followers"] },
      channel: { state: "failed", message: "Unavailable" },
    });

    renderPopout();

    const liveRegion = document.querySelector("[aria-live='polite']");
    expect(liveRegion).toHaveTextContent("Account creation date could not be verified.");
    expect(liveRegion).toHaveTextContent("Reconnect Twitch to verify the follow relationship.");
    expect(liveRegion).toHaveTextContent("Channel is unavailable.");
  });

  it("announces each unavailable remote field once", () => {
    mockedUseUserProfile.mockReturnValue({
      ...pendingProfileState(),
      identity: { state: "unavailable", message: "Unavailable" },
      accountCreated: { state: "unavailable", message: "Unavailable" },
      follow: { state: "unavailable", message: "Unavailable" },
      channel: { state: "unavailable", message: "Unavailable" },
    });

    renderPopout();

    const liveRegion = document.querySelector("[aria-live='polite']");
    expect(liveRegion).toHaveTextContent(
      "Profile identity is unavailable. Account creation date is unavailable. Follow relationship is unavailable. Channel is unavailable."
    );
  });
});
