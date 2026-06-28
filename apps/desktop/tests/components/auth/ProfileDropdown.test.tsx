import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KickUser, TwitchUser } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { renderWithProviders, routerMock, screen, userEvent } from "../../test-utils";

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  ...routerMock(),
  useNavigate: () => navigateMock,
}));

import { ProfileDropdown } from "@/components/auth/ProfileDropdown";

const twitchUser: TwitchUser = {
  id: "1",
  login: "darkskyfullofstars",
  displayName: "DarkSkyFullOfStars",
  profileImageUrl: "https://example.com/twitch.png",
  createdAt: "2026-01-01T00:00:00Z",
  broadcasterType: "",
};

const kickUser: KickUser = {
  id: 2,
  username: "anonsociety",
  slug: "anonsociety",
  profilePic: "https://example.com/kick.png",
  verified: false,
};

beforeEach(() => {
  useAuthStore.setState({
    twitchUser: null,
    twitchConnected: false,
    twitchLoading: false,
    kickUser: null,
    kickConnected: false,
    kickLoading: false,
    isGuest: true,
    initialized: true,
    error: null,
    localFollows: [],
    followsLoading: false,
    preferences: null,
  });
  navigateMock.mockClear();
});

// Guards: profile dropdown channel actions must navigate inside StreamFusion to the authenticated account's real platform channel instead of opening an external browser URL or using a stale display name
describe("ProfileDropdown", () => {
  it("navigates to connected Twitch and Kick account channels inside the app", async () => {
    useAuthStore.setState({
      twitchUser,
      twitchConnected: true,
      kickUser,
      kickConnected: true,
      isGuest: false,
    });

    renderWithProviders(<ProfileDropdown />);

    await userEvent.click(screen.getAllByRole("button")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Twitch Channel" }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "twitch", channel: "darkskyfullofstars" },
      search: { tab: "home" },
    });

    await userEvent.click(screen.getAllByRole("button")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Kick Channel" }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "anonsociety" },
      search: { tab: "home" },
    });
  });
});
