import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mockedUseUserProfile = vi.mocked(useUserProfile);

beforeEach(() => {
  mockedUseUserProfile.mockReset();
  // Stub the electronAPI for openExternal usage inside the footer.
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (globalThis as any).window.electronAPI = {
    openExternal: vi.fn(),
    auth: { getToken: vi.fn().mockResolvedValue(null) },
  };
});

function renderPopout(open = true) {
  return render(
    <UserPopout
      userId="u1"
      username="alice"
      platform="twitch"
      channelId="c1"
      channelSlug="streamer"
      open={open}
      onOpenChange={() => {}}
    />,
  );
}

describe("UserPopout", () => {
  it("renders the skeleton while profile is null and loading", () => {
    mockedUseUserProfile.mockReturnValue({
      profile: null,
      loading: true,
      error: null,
    });
    renderPopout();
    expect(screen.getByTestId("user-popout-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("user-popout-not-found")).toBeNull();
  });

  it("renders 'User not found' when error === 'not-found'", () => {
    mockedUseUserProfile.mockReturnValue({
      profile: null,
      loading: false,
      error: "not-found",
    });
    renderPopout();
    expect(screen.getByTestId("user-popout-not-found")).toBeInTheDocument();
    expect(screen.getByText(/User not found/)).toBeInTheDocument();
  });

  it("renders the profile header (display name + @username) when profile is loaded", () => {
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
    });
    renderPopout();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByTestId("user-popout-footer")).toBeInTheDocument();
  });

  it("renders nothing in the document body when open=false", () => {
    mockedUseUserProfile.mockReturnValue({
      profile: null,
      loading: true,
      error: null,
    });
    renderPopout(false);
    expect(screen.queryByTestId("user-popout")).toBeNull();
    expect(screen.queryByTestId("user-popout-skeleton")).toBeNull();
  });
});
