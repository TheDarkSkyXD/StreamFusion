import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserPopoutFooter } from "@/features/chat/components/chat/mod/UserPopout/UserPopoutFooter";
import { installElectronAPIMock } from "../../../../test-utils";

beforeEach(() => {
  const api = installElectronAPIMock();
  api.openExternal = vi.fn();
  api.moderation.createTimeoutSnapshot = vi.fn().mockResolvedValue({
        state: "unavailable",
        reason: "invalid-target-state",
      });
  api.moderation.submitTimeout = vi.fn();
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
