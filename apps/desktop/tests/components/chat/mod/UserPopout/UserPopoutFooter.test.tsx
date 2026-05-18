import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Helix mutation helpers up-front. The footer imports them by name.
vi.mock("@/backend/api/platforms/twitch/twitch-helix-moderation-mutations", () => {
  return {
    addModerator: vi.fn(),
    addVip: vi.fn(),
    banUser: vi.fn(),
    deleteChatMessage: vi.fn(),
    removeModerator: vi.fn(),
    removeVip: vi.fn(),
    timeoutUser: vi.fn(),
    unbanUser: vi.fn(),
  };
});
vi.mock("@/backend/api/platforms/kick/kick-mod-mutations", () => ({
  banKickUser: vi.fn(),
  deleteKickMessage: vi.fn(),
  timeoutKickUser: vi.fn(),
  unbanKickUser: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { UserPopoutFooter } from "@/components/chat/mod/UserPopout/UserPopoutFooter";
import { banUser } from "@/backend/api/platforms/twitch/twitch-helix-moderation-mutations";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

const mockedBan = vi.mocked(banUser);

beforeEach(() => {
  vi.clearAllMocks();
  useDevModOverrideStore.setState({ showWhisper: false });
  // biome-ignore lint/suspicious/noExplicitAny: jsdom electronAPI stub
  (globalThis as any).window.electronAPI = {
    openExternal: vi.fn(),
    auth: {
      getToken: vi.fn().mockResolvedValue({ accessToken: "test-token" }),
    },
  };
});

function setup(overrides: Partial<React.ComponentProps<typeof UserPopoutFooter>> = {}) {
  const props: React.ComponentProps<typeof UserPopoutFooter> = {
    userId: "u1",
    username: "alice",
    platform: "twitch",
    channelId: "c1",
    channelSlug: "streamer",
    isBroadcaster: false,
    latestMessageId: "msg1",
    ...overrides,
  };
  return render(<UserPopoutFooter {...props} />);
}

describe("UserPopoutFooter", () => {
  it("renders Timeout / Ban / Unban / Delete unconditionally", () => {
    setup();
    expect(screen.getByRole("button", { name: /Timeout user/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ban user/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unban user/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete most recent message/ }),
    ).toBeInTheDocument();
  });

  it("hides Add Mod / VIP buttons when the operator is not the broadcaster", () => {
    setup({ isBroadcaster: false });
    expect(screen.queryByRole("button", { name: /Add moderator/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add VIP/ })).toBeNull();
  });

  it("renders Add/Remove Mod and Add/Remove VIP only when broadcaster identity matches (Twitch)", () => {
    setup({ isBroadcaster: true });
    expect(screen.getByRole("button", { name: /Add moderator/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove moderator/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add VIP/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove VIP/ })).toBeInTheDocument();
  });

  it("hides Whisper by default, shows it when devSettings.showWhisper=true", () => {
    const { unmount } = setup();
    expect(screen.queryByTestId("user-popout-footer-whisper")).toBeNull();
    unmount();
    useDevModOverrideStore.setState({ showWhisper: true });
    setup();
    expect(screen.getByTestId("user-popout-footer-whisper")).toBeInTheDocument();
  });

  it("Open external calls window.electronAPI.openExternal with the right URL per platform", () => {
    const { unmount } = setup({ platform: "twitch", username: "alice" });
    fireEvent.click(screen.getByTestId("user-popout-footer-external"));
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith(
      "https://twitch.tv/alice",
    );
    unmount();
    vi.clearAllMocks();
    setup({ platform: "kick", username: "bob" });
    fireEvent.click(screen.getByTestId("user-popout-footer-external"));
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith(
      "https://kick.com/bob",
    );
  });

  it("Click Ban → confirm dialog → calls banUser mutation", async () => {
    mockedBan.mockResolvedValue({
      ok: true,
      payload: {
        broadcaster_id: "c1",
        moderator_id: "c1",
        user_id: "u1",
        created_at: "",
        end_time: null,
      },
    });
    const onActionSuccess = vi.fn();
    setup({ onActionSuccess });

    fireEvent.click(screen.getByRole("button", { name: /Ban user/ }));
    const confirmButton = await screen.findByRole("button", { name: /^Ban user$/ });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockedBan).toHaveBeenCalledTimes(1);
    });
    expect(mockedBan).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "test-token",
        broadcasterId: "c1",
        userId: "u1",
      }),
    );
    await waitFor(() => {
      expect(onActionSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
