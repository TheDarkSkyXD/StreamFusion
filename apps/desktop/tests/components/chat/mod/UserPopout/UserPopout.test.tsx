import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import type { ChatMessage } from "@/shared/chat-types";
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

function renderPopout(open = true, platform: "twitch" | "kick" = "twitch") {
  return render(
    <TooltipProvider>
      <UserPopout
        userId="u1"
        username="alice"
        platform={platform}
        channelId="c1"
        channelSlug="streamer"
        open={open}
        onOpenChange={() => {}}
      />
    </TooltipProvider>
  );
}

// Guards: failed remote identity keeps chat-known identity visible and exposes a field-level retry.
// Guards: identity loading remains visible without delaying the dialog shell.
// Guards: Kick user dialogs keep Kick-specific accessible copy and external profile navigation.
describe("UserPopout", () => {
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
    expect(liveRegion).toHaveTextContent("Follow relationship is unavailable.");
    expect(liveRegion).not.toHaveTextContent("Reconnect Twitch");
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
