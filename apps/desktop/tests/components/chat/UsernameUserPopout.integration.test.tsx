import { fireEvent, render, screen } from "@testing-library/react";
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
