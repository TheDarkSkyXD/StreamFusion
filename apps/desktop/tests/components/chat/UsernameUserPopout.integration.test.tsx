import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/chat/mod/UserPopout/useUserProfile", () => ({
  useUserProfile: vi.fn(() => ({
    profile: null,
    loading: false,
    error: null,
    identity: { state: "loading" },
    accountCreated: { state: "loading" },
    follow: { state: "loading" },
    channel: { state: "loading" },
    retryIdentity: vi.fn(),
    retryAccountCreated: vi.fn(),
    retryFollow: vi.fn(),
    retryChannel: vi.fn(),
  })),
}));

import { ChatMessage } from "@/components/chat/ChatMessage";
import { UserPopoutProvider } from "@/components/chat/mod/UserPopout/UserPopoutProvider";
import { useUserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";
import { Username } from "@/components/chat/Username";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChatMessage as ChatMessageType } from "@/shared/chat-types";

// Guards: chat-known Kick display name and avatar survive the username-click boundary into the dialog.
describe("Username user-popout wiring", () => {
  it("restores the original chat opener after a normal Close", async () => {
    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <Username
            userId="clicked-user"
            username="alice"
            displayName="Alice"
            platform="twitch"
            currentChannelContext={{ channelId: "stream-id", channelSlug: "streamer" }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );

    const opener = screen.getByRole("button", { name: "Alice" });
    opener.focus();
    fireEvent.click(opener);
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    await waitFor(() => expect(screen.queryByTestId("user-popout")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes for View Channel and navigates only with the known resolved profile channel", async () => {
    vi.mocked(useUserProfile).mockReturnValueOnce({
      profile: null,
      loading: false,
      error: null,
      identity: { state: "loading" },
      accountCreated: { state: "loading" },
      follow: { state: "loading" },
      channel: {
        state: "known",
        source: "official",
        value: { id: "alice-id", username: "resolved-alice", displayName: "Alice" },
      },
      retryIdentity: vi.fn(),
      retryAccountCreated: vi.fn(),
      retryFollow: vi.fn(),
      retryChannel: vi.fn(),
    });
    const onViewChannel = vi.fn();
    render(
      <TooltipProvider>
        <UserPopoutProvider
          publicActions={{
            replyEligibility: null,
            onReply: vi.fn(),
            onViewChannel,
          }}
        >
          <Username
            userId="clicked-user"
            username="alice"
            displayName="Alice"
            platform="twitch"
            currentChannelContext={{ channelId: "stream-id", channelSlug: "streamer" }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );

    const opener = screen.getByRole("button", { name: "Alice" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "View Channel" }));

    await waitFor(() =>
      expect(onViewChannel).toHaveBeenCalledWith("twitch", {
        id: "alice-id",
        username: "resolved-alice",
        displayName: "Alice",
      })
    );
    expect(screen.queryByTestId("user-popout")).toBeNull();
    expect(opener).not.toHaveFocus();
  });

  it("closes for Reply without restoring the opener and forwards the exact selected message to the composer", async () => {
    const openingMessage: ChatMessageType = {
      id: "reply-target",
      platform: "twitch",
      channel: "streamer",
      type: "message",
      userId: "alice-id",
      username: "alice",
      displayName: "Alice",
      color: "#fff",
      badges: [],
      content: [{ type: "text", content: "Exact reply target" }],
      rawContent: "Exact reply target",
      timestamp: new Date("2026-07-30T00:00:00Z"),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };
    const onReply = vi.fn(() => screen.getByTestId("composer").focus());

    render(
      <TooltipProvider>
        <UserPopoutProvider
          publicActions={{
            replyEligibility: { state: "eligible" },
            onReply,
            onViewChannel: vi.fn(),
          }}
        >
          <input data-testid="composer" />
          <ChatMessage
            message={openingMessage}
            currentChannelContext={{ channelId: "stream-id", channelSlug: "streamer" }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );

    const opener = screen.getByRole("button", { name: "Alice" });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(screen.queryByTestId("user-popout")).toBeNull();
    await waitFor(() => expect(onReply).toHaveBeenCalledWith(openingMessage));
    await waitFor(() => expect(screen.getByTestId("composer")).toHaveFocus());
    expect(opener).not.toHaveFocus();
  });

  it("passes the clicked chatter identity separately from the current channel", () => {
    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <Username
            userId="clicked-user"
            username="alice"
            displayName="Alice"
            platform="twitch"
            currentChannelContext={{ channelId: "stream-id", channelSlug: "streamer" }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Alice" }));

    expect(screen.getByTestId("user-popout")).toBeInTheDocument();
    expect(useUserProfile).toHaveBeenCalledWith(
      "clicked-user",
      "twitch",
      "stream-id",
      "alice",
      "streamer"
    );
  });

  it("opens a Kick dialog immediately with chat-known display name and avatar", () => {
    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <Username
            userId="kick-user"
            username="alice"
            displayName="Alice"
            avatarUrl="https://files.kick.com/images/user/123/profile_image/conversion/abc-fullsize.webp"
            platform="kick"
            currentChannelContext={{ channelId: "stream-id", channelSlug: "streamer" }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Alice" }));

    expect(screen.getByRole("heading", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alice avatar" })).toBeInTheDocument();
  });

  it("threads the exact clicked message snapshot into the initial selection", () => {
    const openingMessage: ChatMessageType = {
      id: "opening-message",
      platform: "kick",
      channel: "streamer",
      type: "message",
      userId: "kick-user",
      username: "alice",
      displayName: "Alice",
      color: "#53fc18",
      badges: [],
      content: [{ type: "text", content: "Open this exact row" }],
      rawContent: "Open this exact row",
      timestamp: new Date("2026-07-30T00:00:00Z"),
      isDeleted: false,
      isHighlighted: false,
      isAction: false,
    };

    render(
      <TooltipProvider>
        <UserPopoutProvider>
          <ChatMessage
            message={openingMessage}
            currentChannelContext={{ channelId: "stream-id", channelSlug: "streamer" }}
          />
        </UserPopoutProvider>
      </TooltipProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Alice" }));

    expect(screen.getByTestId("user-popout-selected-footer")).toHaveAttribute(
      "data-selected-message-id",
      "opening-message"
    );
    expect(screen.getByTestId("user-popout-selected-footer")).toHaveAttribute(
      "data-selected-author-id",
      "kick-user"
    );
  });
});
