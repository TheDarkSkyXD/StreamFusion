import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserPopoutFooter } from "@/components/chat/mod/UserPopout/UserPopoutFooter";

beforeEach(() => {
  (window as any).electronAPI = {
    openExternal: vi.fn(),
    moderation: {
      createTimeoutSnapshot: vi.fn().mockResolvedValue({
        state: "unavailable",
        reason: "invalid-target-state",
      }),
      submitTimeout: vi.fn(),
    },
  };
});

describe("UserPopoutFooter compatibility wrapper", () => {
  it("keeps external navigation while Timeout remains main-state gated", async () => {
    render(
      <UserPopoutFooter
        userId="u1"
        username="alice"
        platform="twitch"
        channelId="c1"
        channelSlug="streamer"
        isBroadcaster={false}
        latestMessageId="m1"
      />
    );
    await waitFor(() =>
      expect(window.electronAPI.moderation.createTimeoutSnapshot).toHaveBeenCalledTimes(1)
    );
    expect(screen.queryByRole("button", { name: "Timeout user" })).toBeNull();
    fireEvent.click(screen.getByTestId("user-popout-footer-external"));
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith("https://twitch.tv/alice");
  });
});
