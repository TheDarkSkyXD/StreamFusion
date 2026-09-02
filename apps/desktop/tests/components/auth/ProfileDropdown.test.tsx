import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_PREFERENCES, type KickUser, type TwitchUser } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import "@/i18n";

import { renderWithProviders, routerMock, screen, userEvent } from "../../test-utils";

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  ...routerMock(),
  useNavigate: () => navigateMock,
}));

import { ProfileDropdown } from "@/features/auth/components/auth/ProfileDropdown";

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
    twitchReconnectRequired: false,
    twitchLoading: false,
    kickUser: null,
    kickConnected: false,
    kickLoading: false,
    isGuest: true,
    initialized: true,
    error: null,
    localFollows: [],
    followsLoading: false,
    preferences: DEFAULT_USER_PREFERENCES,
    updatePreferences: vi.fn(),
  });
  navigateMock.mockClear();
});

// Guards: profile dropdown trigger must expose an accessible name so keyboard, screen-reader, and runtime automation users can open the account menu
// Guards: profile dropdown channel actions must navigate inside StreamFusion to the authenticated account's real platform channel instead of opening an external browser URL or using a stale display name
// Guards: the profile language selector persists through the same preference path as Settings.
// Guards: a linked Twitch identity stays visible and reconnectable while its authorization is degraded.
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

    const trigger = screen.getByRole("button", { name: "Open profile menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Twitch Channel" }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "twitch", channel: "darkskyfullofstars" },
      search: { tab: "home" },
    });

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Kick Channel" }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "anonsociety" },
      search: { tab: "home" },
    });
  });

  it("writes the selected display language through the shared preference path", async () => {
    const updatePreferences = vi.fn(async () => ({ success: true }));
    useAuthStore.setState({ updatePreferences });
    renderWithProviders(<ProfileDropdown />);
    await userEvent.click(screen.getByRole("button", { name: "Open profile menu" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Display language" }));
    await userEvent.click(screen.getByRole("option", { name: "Español (Spanish)" }));
    expect(updatePreferences).toHaveBeenCalledWith({ language: "es" });
  });

  it("keeps a linked Twitch identity visible while authorization needs reconnecting", async () => {
    const loginTwitch = vi.fn(async () => undefined);
    const logoutTwitch = vi.fn(async () => undefined);
    useAuthStore.setState({
      twitchUser,
      twitchConnected: false,
      twitchReconnectRequired: true,
      isGuest: false,
      loginTwitch,
      logoutTwitch,
    });

    renderWithProviders(<ProfileDropdown />);
    await userEvent.click(screen.getByRole("button", { name: "Open profile menu" }));

    expect(screen.getAllByText("DarkSkyFullOfStars").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Connect Twitch" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect Twitch" }));
    expect(loginTwitch).toHaveBeenCalledTimes(1);
    expect(logoutTwitch).not.toHaveBeenCalled();
  });
});
