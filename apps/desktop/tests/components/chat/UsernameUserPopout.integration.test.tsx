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

import { UserPopoutProvider } from "@/components/chat/mod/UserPopout/UserPopoutProvider";
import { useUserProfile } from "@/components/chat/mod/UserPopout/useUserProfile";
import { Username } from "@/components/chat/Username";
import { TooltipProvider } from "@/components/ui/tooltip";

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
});
